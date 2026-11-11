/**
 * Doble en memoria de DynamoDB solo para la tabla `Projects`: entiende `QueryCommand` sobre el GSI
 * `status-createdAt` y `GetCommand`, y respeta `ProjectionExpression`. Registra cada llamada para
 * poder comprobar qué tablas e índices se consultan. No emula transacciones ni escrituras.
 */
import type { DocClient } from "../../src/shared/dynamodb";
import { createRecordingClient, type RecordedCall, type RecordingClient } from "./setup";

type Item = Record<string, unknown>;

export interface FakeProjectsOptions {
  tableName?: string;
  /** Simula paginación de DynamoDB: máximo de items por página de Query. */
  pageSize?: number;
}

function project(item: Item, projection: string | undefined, names: Record<string, string>) {
  if (!projection) return { ...item };
  const out: Item = {};
  for (const token of projection.split(",").map((part) => part.trim())) {
    const attribute = names[token] ?? token;
    if (attribute in item) out[attribute] = item[attribute];
  }
  return out;
}

export function createFakeProjectsDynamo(
  items: readonly object[],
  options: FakeProjectsOptions = {},
): RecordingClient & DocClient {
  const tableName = options.tableName ?? "testProjects";
  const rows = items as readonly Item[];

  return createRecordingClient((call: RecordedCall) => {
    const input = call.input;
    if (input.TableName !== tableName) {
      return Object.assign(new Error("ResourceNotFoundException"), {
        name: "ResourceNotFoundException",
      });
    }
    const names = (input.ExpressionAttributeNames ?? {}) as Record<string, string>;

    if (call.name === "GetCommand") {
      const key = (input.Key as Item).projectId;
      const found = rows.find((item) => item.projectId === key);
      return found
        ? { Item: project(found, input.ProjectionExpression as string | undefined, names) }
        : {};
    }

    if (call.name === "QueryCommand") {
      if (input.IndexName !== "status-createdAt") {
        return Object.assign(new Error("ValidationException"), { name: "ValidationException" });
      }
      const status = (input.ExpressionAttributeValues as Item)[":s"];
      let matching = rows
        .filter((item) => item.status === status)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      if (input.ScanIndexForward === false) matching = matching.reverse();

      const start = input.ExclusiveStartKey
        ? matching.findIndex(
            (item) => item.projectId === (input.ExclusiveStartKey as Item).projectId,
          ) + 1
        : 0;
      const pageSize = options.pageSize ?? matching.length;
      const page = matching.slice(start, start + pageSize);
      const more = start + pageSize < matching.length;

      return {
        Items: page.map((item) =>
          project(item, input.ProjectionExpression as string | undefined, names),
        ),
        Count: page.length,
        ...(more ? { LastEvaluatedKey: { projectId: page[page.length - 1]!.projectId } } : {}),
      };
    }

    return Object.assign(new Error(`Comando no soportado: ${call.name}`), {
      name: "AccessDeniedException",
    });
  });
}
