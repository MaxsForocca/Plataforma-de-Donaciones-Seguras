/**
 * Fábrica del DocumentClient de DynamoDB y utilidades de transacciones (T016).
 * El cliente no recibe credenciales explícitas: en Lambda usa el rol de la función.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { getConfig, type AppConfig } from "./config";

/** Subconjunto del cliente que usan los repositorios (facilita los dobles de prueba). */
export type DocClient = Pick<DynamoDBDocumentClient, "send">;

export type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

export type TableNames = AppConfig["tables"];

export function resolveTableNames(config: AppConfig = getConfig()): TableNames {
  return config.tables;
}

export function createDocumentClient(config: AppConfig = getConfig()): DynamoDBDocumentClient {
  const base = new DynamoDBClient(
    config.dynamodbEndpoint ? { endpoint: config.dynamodbEndpoint } : {},
  );
  return DynamoDBDocumentClient.from(base, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: false },
    unmarshallOptions: { wrapNumbers: false },
  });
}

let cachedClient: DynamoDBDocumentClient | undefined;

/** Cliente compartido por invocaciones calientes de la misma instancia de Lambda. */
export function getDocumentClient(): DynamoDBDocumentClient {
  cachedClient ??= createDocumentClient();
  return cachedClient;
}

/** Solo para pruebas. */
export function resetDocumentClientCache(): void {
  cachedClient = undefined;
}

/**
 * Códigos de cancelación de un `TransactionCanceledException`, en el mismo orden que los items de
 * la transacción (p. ej. `["None", "ConditionalCheckFailed", "None"]`). Devuelve `[]` si el error
 * no es una cancelación de transacción.
 */
export function cancellationCodes(error: unknown): string[] {
  if (typeof error !== "object" || error === null) return [];
  const candidate = error as { name?: unknown; CancellationReasons?: unknown };
  if (candidate.name !== "TransactionCanceledException") return [];
  if (!Array.isArray(candidate.CancellationReasons)) return [];
  return candidate.CancellationReasons.map((reason: unknown) => {
    const code = (reason as { Code?: unknown } | null)?.Code;
    return typeof code === "string" ? code : "None";
  });
}

/** `true` si el item `index` de la transacción falló por su condición. */
export function failedConditionAt(error: unknown, index: number): boolean {
  return cancellationCodes(error)[index] === "ConditionalCheckFailed";
}
