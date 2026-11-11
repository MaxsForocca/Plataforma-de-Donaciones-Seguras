/**
 * Doble en memoria de las cuatro tablas (Projects, Donations, Idempotency, AuditEvents) con
 * transacciones ATÓMICAS: `TransactWriteCommand` evalúa todas las condiciones antes de aplicar
 * nada y, si alguna falla, lanza `TransactionCanceledException` con `CancellationReasons` en el
 * orden de los items y no escribe NADA. Solo entiende las expresiones que usa el backend; cualquier
 * otra falla en voz alta. La semántica real se contrasta contra DynamoDB Local en las pruebas de
 * integración (se ejecutan los mismos escenarios en ambos entornos).
 */
import type { AppConfig } from "../../src/shared/config";
import type { DocClient } from "../../src/shared/dynamodb";
import { createRecordingClient, type RecordedCall, type RecordingClient } from "./setup";

type Item = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type TableKey = "projects" | "donations" | "idempotency" | "audit";

const KEY_ATTRIBUTES: Record<TableKey, string[]> = {
  projects: ["projectId"],
  donations: ["donationId"],
  idempotency: ["pk"],
  audit: ["eventType", "sk"],
};

const error = (name: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(name), { name }, extra);

export interface FakeTables {
  client: RecordingClient & DocClient;
  /** Contenido actual de una tabla (copias). */
  dump(table: TableKey): Item[];
  /** Escribe (o reemplaza) un item directamente, sin condiciones (para preparar escenarios). */
  put(table: TableKey, item: object): void;
  /** Antes de procesar cada comando, `fault` puede devolver un error que se lanzará en su lugar. */
  injectFault(fault: (call: RecordedCall) => Error | undefined): void;
  clearFaults(): void;
}

export function createFakeTables(
  config: AppConfig,
  seed: Partial<Record<TableKey, readonly object[]>> = {},
): FakeTables {
  const names: Record<string, TableKey> = {
    [config.tables.projects]: "projects",
    [config.tables.donations]: "donations",
    [config.tables.idempotency]: "idempotency",
    [config.tables.audit]: "audit",
  };
  const data: Record<TableKey, Map<string, Item>> = {
    projects: new Map(),
    donations: new Map(),
    idempotency: new Map(),
    audit: new Map(),
  };
  const keyOf = (table: TableKey, item: Item) =>
    KEY_ATTRIBUTES[table].map((attribute) => String(item[attribute])).join("\u0000");

  for (const [table, items] of Object.entries(seed) as [TableKey, readonly object[]][]) {
    for (const item of items)
      data[table].set(keyOf(table, item as Item), structuredClone(item as Item));
  }

  const faults: ((call: RecordedCall) => Error | undefined)[] = [];
  const resolve = (tableName: unknown): TableKey => {
    const table = names[String(tableName)];
    if (!table) throw error("ResourceNotFoundException");
    return table;
  };

  function attributeName(token: string, names2: Record<string, string> | undefined): string {
    return token.startsWith("#") ? (names2?.[token] ?? token) : token;
  }

  /** Evalúa las condiciones que usa el backend: attribute_(not_)exists(x) y `x = :v`, unidas por AND. */
  function conditionHolds(
    expression: string | undefined,
    current: Item | undefined,
    names2: Record<string, string> | undefined,
    values: Record<string, unknown> | undefined,
  ): boolean {
    if (!expression) return true;
    return expression.split(/\s+AND\s+/i).every((term) => {
      const t = term.trim();
      let match = /^attribute_not_exists\((.+)\)$/.exec(t);
      if (match) return current === undefined || !(attributeName(match[1]!, names2) in current);
      match = /^attribute_exists\((.+)\)$/.exec(t);
      if (match) return current !== undefined && attributeName(match[1]!, names2) in current;
      match = /^(\S+)\s*=\s*(:\w+)$/.exec(t);
      if (match) {
        return (
          current !== undefined && current[attributeName(match[1]!, names2)] === values?.[match[2]!]
        );
      }
      throw new Error(`Condición no soportada por el doble: ${t}`);
    });
  }

  /** `SET a = :v, #n = :w` y `ADD x :v`. */
  function applyUpdate(
    item: Item,
    expression: string,
    names2: Record<string, string> | undefined,
    values: Record<string, unknown> | undefined,
  ) {
    const out = { ...item };
    const set = /SET\s+(.+?)(?=\s+ADD\s|$)/i.exec(expression);
    if (set) {
      for (const assignment of set[1]!.split(",")) {
        const [left, right] = assignment.split("=").map((part) => part.trim());
        out[attributeName(left!, names2)] = values?.[right!];
      }
    }
    const add = /ADD\s+(\S+)\s+(:\w+)/i.exec(expression);
    if (add) {
      const attribute = attributeName(add[1]!, names2);
      out[attribute] = (Number(out[attribute]) || 0) + Number(values?.[add[2]!]);
    }
    return out;
  }

  const project = (
    item: Item,
    projection: string | undefined,
    names2: Record<string, string> | undefined,
  ) => {
    if (!projection) return structuredClone(item);
    const out: Item = {};
    for (const token of projection.split(",").map((p) => p.trim())) {
      const attribute = attributeName(token, names2);
      if (attribute in item) out[attribute] = item[attribute];
    }
    return structuredClone(out);
  };

  function transact(items: Item[]) {
    const reasons: { Code: string }[] = [];
    const planned: (() => void)[] = [];
    const seen = new Set<string>();
    let failed = false;

    for (const entry of items) {
      const operation = (entry.Put ?? entry.Update ?? entry.ConditionCheck ?? entry.Delete) as Item;
      const table = resolve(operation.TableName);
      const key =
        entry.Put !== undefined ? keyOf(table, operation.Item) : keyOf(table, operation.Key);
      if (seen.has(`${table}:${key}`)) {
        throw error("ValidationException", {
          message: "Transaction request cannot include multiple operations on one item",
        });
      }
      seen.add(`${table}:${key}`);

      const current = data[table].get(key);
      const ok = conditionHolds(
        operation.ConditionExpression,
        current,
        operation.ExpressionAttributeNames,
        operation.ExpressionAttributeValues,
      );
      reasons.push({ Code: ok ? "None" : "ConditionalCheckFailed" });
      if (!ok) failed = true;

      if (entry.Put) planned.push(() => data[table].set(key, structuredClone(operation.Item)));
      else if (entry.Update) {
        planned.push(() =>
          data[table].set(
            key,
            applyUpdate(
              current ?? { ...operation.Key },
              operation.UpdateExpression,
              operation.ExpressionAttributeNames,
              operation.ExpressionAttributeValues,
            ),
          ),
        );
      } else if (entry.Delete) planned.push(() => data[table].delete(key));
    }

    if (failed) throw error("TransactionCanceledException", { CancellationReasons: reasons });
    planned.forEach((apply) => apply()); // todo o nada
  }

  function handle(call: RecordedCall): unknown {
    for (const fault of faults) {
      const injected = fault(call);
      if (injected) return injected;
    }
    const input = call.input;
    try {
      if (call.name === "GetCommand") {
        const table = resolve(input.TableName);
        const item = data[table].get(keyOf(table, input.Key));
        return item
          ? { Item: project(item, input.ProjectionExpression, input.ExpressionAttributeNames) }
          : {};
      }
      if (call.name === "PutCommand") {
        const table = resolve(input.TableName);
        const key = keyOf(table, input.Item);
        if (
          !conditionHolds(
            input.ConditionExpression,
            data[table].get(key),
            input.ExpressionAttributeNames,
            input.ExpressionAttributeValues,
          )
        ) {
          return error("ConditionalCheckFailedException");
        }
        data[table].set(key, structuredClone(input.Item));
        return {};
      }
      if (call.name === "TransactWriteCommand") {
        transact(input.TransactItems as Item[]);
        return {};
      }
      if (call.name === "QueryCommand") {
        const table = resolve(input.TableName);
        const indexAttribute =
          input.IndexName === "status-createdAt"
            ? "status"
            : input.IndexName === "donorSub-createdAt"
              ? "donorSub"
              : null;
        if (!indexAttribute) return error("ValidationException");
        const wanted = Object.values(input.ExpressionAttributeValues as Record<string, unknown>)[0];
        let rows = [...data[table].values()]
          .filter((row) => row[indexAttribute] === wanted)
          .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
        if (input.ScanIndexForward === false) rows = rows.reverse();
        return {
          Items: rows.map((row) =>
            project(row, input.ProjectionExpression, input.ExpressionAttributeNames),
          ),
        };
      }
    } catch (caught) {
      return caught instanceof Error ? caught : new Error(String(caught));
    }
    return error("AccessDeniedException", {
      message: `Comando no permitido en el doble: ${call.name}`,
    });
  }

  return {
    client: createRecordingClient(handle),
    dump: (table) => [...data[table].values()].map((item) => structuredClone(item)),
    put: (table, item) =>
      void data[table].set(keyOf(table, item as Item), structuredClone(item as Item)),
    injectFault: (fault) => void faults.push(fault),
    clearFaults: () => void (faults.length = 0),
  };
}
