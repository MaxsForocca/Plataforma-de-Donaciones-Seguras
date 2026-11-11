/**
 * Validador estático de OpenAPI 3.1 (T108).
 * Verifica que contracts/openapi.yaml y docs/api.yaml existan, sean YAML válidos,
 * cumplan la estructura OpenAPI 3.1.0 y contengan todas las rutas y esquemas requeridos.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  pathsCount: number;
  schemasCount: number;
}

export function validateOpenApiDocument(filePath: string): ValidationResult {
  const errors: string[] = [];
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (err) {
    return { valid: false, errors: [`No se pudo leer el archivo: ${String(err)}`], pathsCount: 0, schemasCount: 0 };
  }

  let doc: Record<string, unknown>;
  try {
    doc = parse(content) as Record<string, unknown>;
  } catch (err) {
    return { valid: false, errors: [`Error de sintaxis YAML: ${String(err)}`], pathsCount: 0, schemasCount: 0 };
  }

  if (doc.openapi !== "3.1.0") {
    errors.push(`openapi debe ser '3.1.0', recibido: '${String(doc.openapi)}'`);
  }

  const info = doc.info as Record<string, unknown> | undefined;
  if (!info || typeof info !== "object") {
    errors.push("Falta la sección 'info'");
  } else {
    if (!info.title) errors.push("Falta 'info.title'");
    if (!info.version) errors.push("Falta 'info.version'");
  }

  const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>> | undefined;
  if (!paths || typeof paths !== "object") {
    errors.push("Falta la sección 'paths'");
  }

  const pathsCount = paths ? Object.keys(paths).length : 0;
  const expectedPaths = [
    "/v1/projects",
    "/v1/projects/{projectId}",
    "/v1/projects/{projectId}/stats",
    "/v1/projects/{projectId}/publish",
    "/v1/donations",
    "/v1/donations/me",
    "/v1/donations/{donationId}",
    "/v1/donations/{donationId}/simulate",
  ];

  for (const expectedPath of expectedPaths) {
    if (!paths?.[expectedPath]) {
      errors.push(`Falta la ruta obligatoria '${expectedPath}'`);
    }
  }

  const components = doc.components as Record<string, unknown> | undefined;
  const schemas = (components?.schemas ?? {}) as Record<string, unknown>;
  const schemasCount = Object.keys(schemas).length;

  const expectedSchemas = [
    "Project",
    "ProjectStats",
    "ProjectCreateRequest",
    "Donation",
    "DonationCreateRequest",
    "DonationSimulateRequest",
    "Error",
  ];

  for (const expectedSchema of expectedSchemas) {
    if (!schemas[expectedSchema]) {
      errors.push(`Falta el esquema obligatorio 'components.schemas.${expectedSchema}'`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    pathsCount,
    schemasCount,
  };
}

export function main() {
  const root = process.cwd();
  const contractPath = resolve(root, "specs/001-secure-donations-core/contracts/openapi.yaml");
  const docsPath = resolve(root, "docs/api.yaml");

  console.log("Validando especificación OpenAPI 3.1...");
  const contractResult = validateOpenApiDocument(contractPath);
  if (!contractResult.valid) {
    console.error("Errores en contracts/openapi.yaml:", contractResult.errors);
    process.exit(1);
  }

  const docsResult = validateOpenApiDocument(docsPath);
  if (!docsResult.valid) {
    console.error("Errores en docs/api.yaml:", docsResult.errors);
    process.exit(1);
  }

  const contractContent = readFileSync(contractPath, "utf8");
  const docsContent = readFileSync(docsPath, "utf8");
  if (contractContent !== docsContent) {
    console.error("docs/api.yaml no está sincronizado con contracts/openapi.yaml");
    process.exit(1);
  }

  console.log(`OpenAPI 3.1 válido: ${contractResult.pathsCount} rutas, ${contractResult.schemasCount} esquemas. Sincronizado en docs/api.yaml.`);
}

if (process.argv[1]?.endsWith("validate-openapi.ts")) {
  main();
}
