import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateOpenApiDocument } from "./validate-openapi";

describe("T108: Validación OpenAPI 3.1", () => {
  const root = resolve(import.meta.dirname, "..");
  const contractPath = resolve(root, "specs/001-secure-donations-core/contracts/openapi.yaml");
  const docsPath = resolve(root, "docs/api.yaml");

  it("contracts/openapi.yaml cumple con OpenAPI 3.1.0 y contiene todas las rutas y esquemas", () => {
    const result = validateOpenApiDocument(contractPath);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.pathsCount).toBeGreaterThanOrEqual(8);
    expect(result.schemasCount).toBeGreaterThanOrEqual(7);
  });

  it("docs/api.yaml cumple con OpenAPI 3.1.0 y contiene todas las rutas y esquemas", () => {
    const result = validateOpenApiDocument(docsPath);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.pathsCount).toBeGreaterThanOrEqual(8);
  });
});
