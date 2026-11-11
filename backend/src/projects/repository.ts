/**
 * Repositorio de lectura pública de proyectos (T040). Solo comandos de lectura (Query/GetItem) y
 * solo proyectos PUBLICADO: los borradores jamás salen de aquí (CA-01.2, CA-02.2). Los atributos
 * se piden con una proyección explícita, de modo que `createdBySub` y cualquier dato interno nunca
 * llegan al handler. Los importes se validan como enteros; un dato corrupto produce un 500
 * controlado en lugar de publicar un valor dudoso (constitución, principio III).
 *
 * Las operaciones de escritura de proyectos (alta y publicación) viven en otros métodos (T066).
 */
import { randomUUID } from "node:crypto";
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import {
  projectSchema,
  projectStatsSchema,
  projectSummarySchema,
  type Project,
  type ProjectStats,
  type ProjectCreateRequest,
  type ProjectSummary,
} from "@donaciones/shared";
import { auditPutItem, buildAuditEvent } from "../audit/repository";
import { failedConditionAt, type DocClient } from "../shared/dynamodb";
import { conflict, internalError, notFound } from "../shared/http";

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

// --- Escritura (T066): alta en BORRADOR y publicación --------------------------------------------

export interface ProjectsWriteTables {
  projects: string;
  audit: string;
}

export interface ProjectsWriteDeps {
  now?: () => Date;
  newId?: () => string;
}

export interface WriteContext {
  /** `sub` verificado del GESTOR (jamás del cliente). */
  actorSub: string;
  requestId: string;
}

/**
 * Alta y publicación de proyectos. Cada escritura es UNA `TransactWriteItems` que incluye el evento
 * de auditoría: el cambio de estado y su evidencia se escriben juntos o no se escriben (constitución,
 * principio IV). El alta condiciona `attribute_not_exists(projectId)`; la publicación exige
 * `status = BORRADOR`, por lo que dos publicaciones concurrentes no pueden tener éxito ambas.
 */
export function createProjectsWriteRepository(
  client: DocClient,
  tables: ProjectsWriteTables,
  deps: ProjectsWriteDeps = {},
) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;

  return {
    /** Crea un proyecto en BORRADOR con acumulado 0; el estado, el id y el propietario los fija el servidor. */
    async createProject(context: WriteContext & { input: ProjectCreateRequest }): Promise<Project> {
      const timestamp = now().toISOString();
      const projectId = newId();
      const item = {
        projectId,
        title: context.input.title,
        description: context.input.description,
        goalAmountCents: context.input.goalAmountCents,
        confirmedAmountCents: 0,
        currency: "PEN",
        status: "BORRADOR",
        createdBySub: context.actorSub,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const audit = buildAuditEvent(
        {
          eventType: "PROJECT_CREATED",
          requestId: context.requestId,
          actorSub: context.actorSub,
          action: "createProject",
          resourceRef: projectId,
          outcome: "SUCCESS",
          metadata: { goalAmountCents: context.input.goalAmountCents },
        },
        { now },
      );

      try {
        await client.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: tables.projects,
                  Item: item,
                  ConditionExpression: "attribute_not_exists(projectId)",
                },
              },
              auditPutItem(tables.audit, audit),
            ],
          }),
        );
      } catch (error) {
        throw internalError(error instanceof Error ? error.name : "alta fallida");
      }
      return parseOrFail<Project>(projectSchema, pick(item, [...DETAIL_ATTRIBUTES, "status"]));
    },

    /** BORRADOR → PUBLICADO. 404 si no existe; 409 si ya estaba publicado o si otro lo publicó antes. */
    async publishProject(context: WriteContext & { projectId: string }): Promise<Project> {
      const read = await client.send(
        new GetCommand({
          TableName: tables.projects,
          Key: { projectId: context.projectId },
          ConsistentRead: true,
          ...projection([...DETAIL_ATTRIBUTES, "status"]),
        }),
      );
      const stored = read.Item as Item | undefined;
      if (!stored) throw notFound("proyecto inexistente");
      if (stored.status === PUBLISHED) throw conflict("el proyecto ya está publicado");
      if (stored.status !== "BORRADOR") throw internalError("estado de proyecto desconocido");

      const current = parseOrFail<Project>(projectSchema, {
        ...pick(stored, DETAIL_ATTRIBUTES),
        status: "BORRADOR",
      });
      const updatedAt = now().toISOString();
      const audit = buildAuditEvent(
        {
          eventType: "PROJECT_PUBLISHED",
          requestId: context.requestId,
          actorSub: context.actorSub,
          action: "publishProject",
          resourceRef: context.projectId,
          outcome: "SUCCESS",
        },
        { now },
      );

      try {
        await client.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: tables.projects,
                  Key: { projectId: context.projectId },
                  UpdateExpression: "SET #status = :published, updatedAt = :now",
                  ConditionExpression: "attribute_exists(projectId) AND #status = :draft",
                  ExpressionAttributeNames: { "#status": "status" },
                  ExpressionAttributeValues: {
                    ":published": PUBLISHED,
                    ":draft": "BORRADOR",
                    ":now": updatedAt,
                  },
                },
              },
              auditPutItem(tables.audit, audit),
            ],
          }),
        );
      } catch (error) {
        // Otro GESTOR publicó entre la lectura y la escritura: la condición falla, no hay efectos.
        if (failedConditionAt(error, 0)) throw conflict("el proyecto ya está publicado");
        throw internalError(error instanceof Error ? error.name : "publicación fallida");
      }
      return parseOrFail<Project>(projectSchema, { ...current, status: PUBLISHED, updatedAt });
    },
  };
}

export type ProjectsWriteRepository = ReturnType<typeof createProjectsWriteRepository>;
