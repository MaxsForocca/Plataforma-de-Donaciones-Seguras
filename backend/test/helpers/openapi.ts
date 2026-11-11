/** Lee el contrato OpenAPI para comprobar que las respuestas reales coinciden con él. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const OPENAPI_PATH = fileURLToPath(
  new URL("../../../specs/001-secure-donations-core/contracts/openapi.yaml", import.meta.url),
);

interface SchemaObject {
  type?: string;
  required?: string[];
  properties?: Record<string, SchemaObject>;
  additionalProperties?: boolean;
  [key: string]: unknown;
}

export interface OpenApiDocument {
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
  components: { schemas: Record<string, SchemaObject> };
}

export function loadOpenApi(): OpenApiDocument {
  return parse(readFileSync(OPENAPI_PATH, "utf8")) as OpenApiDocument;
}
