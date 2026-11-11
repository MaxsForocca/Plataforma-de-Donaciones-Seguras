/**
 * Repositorio de lectura pública de proyectos (T040). Solo comandos de lectura (Query/GetItem) y
 * solo proyectos PUBLICADO: los borradores jamás salen de aquí (CA-01.2, CA-02.2). Los atributos
 * se piden con una proyección explícita, de modo que `createdBySub` y cualquier dato interno nunca
 * llegan al handler. Los importes se validan como enteros; un dato corrupto produce un 500
 * controlado en lugar de publicar un valor dudoso (constitución, principio III).
 *
 * Las operaciones de escritura de proyectos (alta y publicación) viven en otros métodos (T066).
 */
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  projectSchema,
  projectStatsSchema,
  projectSummarySchema,
  type Project,
  type ProjectStats,
  type ProjectSummary,
} from "@donaciones/shared";
import type { DocClient } from "../shared/dynamodb";
import { internalError } from "../shared/http";

export const STATUS_INDEX = "status-createdAt";
const PUBLISHED = "PUBLICADO";
/** Tope de páginas de Query (con ≤ 50 proyectos basta 1); evita bucles ante un fallo del servicio. */
const MAX_PAGES = 20;

const SUMMARY_ATTRIBUTES = [
  "projectId",
  "title",
  "description",
  "goalAmountCents",
  "confirmedAmountCents",
  "currency",
] as const;
const STATS_ATTRIBUTES = [
  "projectId",
  "goalAmountCents",
  "confirmedAmountCents",
  "currency",
] as const;
const DETAIL_ATTRIBUTES = [...SUMMARY_ATTRIBUTES, "createdAt", "updatedAt"] as const;

type Item = Record<string, unknown>;

/** Alias de todos los atributos: `status` y otros nombres pueden ser palabras reservadas. */
function projection(attributes: readonly string[]) {
  const names: Record<string, string> = {};
  for (const attribute of attributes) names[`#${attribute}`] = attribute;
  return {
    ExpressionAttributeNames: names,
    ProjectionExpression: attributes.map((attribute) => `#${attribute}`).join(", "),
  };
}

function pick(item: Item, attributes: readonly string[]): Item {
  const picked: Item = {};
  for (const attribute of attributes) {
    if (attribute in item) picked[attribute] = item[attribute];
  }
  return picked;
}

const isPublished = (item: Item | undefined): item is Item => item?.status === PUBLISHED;

function parseOrFail<T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  value: Item,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw internalError("registro de proyecto inválido");
  return result.data as T;
}

export function createProjectsRepository(client: DocClient, tableName: string) {
  async function getPublishedItem(projectId: string, attributes: readonly string[]) {
    const output = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { projectId },
        ...projection([...attributes, "status"]),
      }),
    );
    const item = output.Item as Item | undefined;
    return isPublished(item) ? item : undefined;
  }

  return {
    /** Proyectos PUBLICADO, del más reciente al más antiguo (consulta del GSI, sin Scan). */
    async listPublished(): Promise<ProjectSummary[]> {
      const items: Item[] = [];
      let startKey: Record<string, unknown> | undefined;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const output = await client.send(
          new QueryCommand({
            TableName: tableName,
            IndexName: STATUS_INDEX,
            KeyConditionExpression: "#status = :s",
            ExpressionAttributeValues: { ":s": PUBLISHED },
            ScanIndexForward: false,
            ExclusiveStartKey: startKey,
            ...projection([...SUMMARY_ATTRIBUTES, "status"]),
          }),
        );
        items.push(...((output.Items ?? []) as Item[]));
        startKey = output.LastEvaluatedKey;

        if (!startKey) {
          // Defensa en profundidad: aunque el índice devolviera otro estado, se descarta.
          return items
            .filter(isPublished)
            .map((item) =>
              parseOrFail<ProjectSummary>(projectSummarySchema, pick(item, SUMMARY_ATTRIBUTES)),
            );
        }
      }
      throw internalError("la consulta del catálogo excedió el máximo de páginas");
    },

    /** Detalle de un proyecto PUBLICADO; `undefined` si no existe o no está publicado. */
    async getProject(projectId: string): Promise<Project | undefined> {
      const item = await getPublishedItem(projectId, DETAIL_ATTRIBUTES);
      if (!item) return undefined;
      return parseOrFail<Project>(projectSchema, {
        ...pick(item, DETAIL_ATTRIBUTES),
        status: PUBLISHED,
      });
    },

    /** Indicadores agregados de un proyecto PUBLICADO; `undefined` si no existe o no está publicado. */
    async getStats(projectId: string): Promise<ProjectStats | undefined> {
      const item = await getPublishedItem(projectId, STATS_ATTRIBUTES);
      if (!item) return undefined;
      return parseOrFail<ProjectStats>(projectStatsSchema, pick(item, STATS_ATTRIBUTES));
    },
  };
}

export type ProjectsRepository = ReturnType<typeof createProjectsRepository>;
