/**
 * T063 — Contrato de `PATCH /v1/projects/{projectId}/publish`: 200, 404 y 409 (más 401/403)
 * (CA-08.2, CA-04.1). Reutiliza la matriz genérica de authz; aquí se comprueba el cableado.
 */
import { errorEnvelopeSchema, projectSchema } from "@donaciones/shared";
import { describe, expect, it } from "vitest";
import { ACTIONS } from "../../src/authz/policies";
import {
  DRAFT_PROJECT,
  DRAFT_PROJECT_ID,
  MISSING_PROJECT_ID,
  PUBLISHED_PROJECT,
  PUBLISHED_PROJECT_ID,
} from "../helpers/fixtures";
import { loadOpenApi } from "../helpers/openapi";
import { auditorEvent, donanteEvent, gestorEvent } from "../helpers/setup";
import { makeMemoryWorld } from "../helpers/world";

const world = () => makeMemoryWorld({ projects: [{ ...DRAFT_PROJECT }, { ...PUBLISHED_PROJECT }] });
const patch = (w: ReturnType<typeof makeMemoryWorld>, projectId: string, make = gestorEvent) =>
  w.publishProject(
    make({
      method: "PATCH",
      path: `/v1/projects/${projectId}/publish`,
      pathParameters: { projectId },
      requestId: "req-p",
    }),
  );
const body = (r: { body?: string }) => JSON.parse(r.body as string);

describe("PATCH /v1/projects/{projectId}/publish", () => {
  it("200: devuelve el proyecto PUBLICADO con el esquema Project", async () => {
    const response = await patch(world(), DRAFT_PROJECT_ID);
    expect(response.statusCode).toBe(200);
    expect(projectSchema.safeParse(body(response)).success).toBe(true);
    expect(body(response).status).toBe("PUBLICADO");
  });

  it("404: proyecto inexistente o id malformado, con el sobre uniforme", async () => {
    for (const id of [MISSING_PROJECT_ID, "no-es-uuid"]) {
      const response = await patch(world(), id);
      expect(response.statusCode).toBe(404);
      expect(errorEnvelopeSchema.safeParse(body(response)).success).toBe(true);
      expect(body(response)).toMatchObject({ code: "NOT_FOUND", requestId: "req-p" });
    }
  });

  it("404: inexistente y malformado son indistinguibles", async () => {
    const a = await patch(world(), MISSING_PROJECT_ID);
    const b = await patch(world(), "x");
    expect(a.body).toBe(b.body);
  });

  it("409: proyecto ya publicado, con el sobre uniforme", async () => {
    const response = await patch(world(), PUBLISHED_PROJECT_ID);
    expect(response.statusCode).toBe(409);
    expect(errorEnvelopeSchema.safeParse(body(response)).success).toBe(true);
    expect(body(response).code).toBe("CONFLICT");
  });

  describe("401 y 403 (sin modificar ningún proyecto)", () => {
    const cases: [string, typeof gestorEvent, number][] = [
      ["sin token", (o) => gestorEvent({ ...o, authorizer: false }), 401],
      ["ID token", (o) => gestorEvent({ ...o, tokenUse: "id" }), 401],
      ["token vencido", (o) => gestorEvent({ ...o, expiresInSeconds: -1 }), 401],
      ["DONANTE", (o) => donanteEvent({ ...o, scopes: ["api/projects.write"] }), 403],
      ["AUDITOR", (o) => auditorEvent({ ...o, scopes: ["api/projects.write"] }), 403],
      ["GESTOR sin scope", (o) => gestorEvent({ ...o, scopes: [] }), 403],
    ];

    it.each(cases)("%s → HTTP %i", async (_label, make, status) => {
      const w = world();
      const before = await w.dump("projects");
      const response = await patch(w, DRAFT_PROJECT_ID, make);
      expect(response.statusCode).toBe(status);
      expect(errorEnvelopeSchema.safeParse(body(response)).success).toBe(true);
      expect(w.calls()).toHaveLength(0);
      expect(await w.dump("projects")).toEqual(before);
    });

    it("un DONANTE no distingue entre proyecto existente e inexistente (403 en ambos)", async () => {
      const make: typeof gestorEvent = (o) =>
        donanteEvent({ ...o, scopes: ["api/projects.write"] });
      const a = await patch(world(), DRAFT_PROJECT_ID, make);
      const b = await patch(world(), MISSING_PROJECT_ID, make);
      expect(a.statusCode).toBe(403);
      expect(a.body).toBe(b.body);
    });
  });

  describe("coincide con contracts/openapi.yaml", () => {
    const operation = loadOpenApi().paths["/v1/projects/{projectId}/publish"]!.patch as unknown as {
      security: Record<string, string[]>[];
      "x-required-group": string;
      responses: Record<string, unknown>;
    };

    it("declara 200, 401, 403, 404, 409 y 500; exige GESTOR y el scope de la política", () => {
      expect(Object.keys(operation.responses).sort()).toEqual([
        "200",
        "401",
        "403",
        "404",
        "409",
        "500",
      ]);
      expect(operation["x-required-group"]).toBe("GESTOR");
      expect(operation.security).toEqual([{ cognitoOAuth: [ACTIONS["project:publish"].scope] }]);
    });
  });
});
