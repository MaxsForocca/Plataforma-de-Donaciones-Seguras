/**
 * T037 — Contrato de `GET /v1/projects/{projectId}/stats`: 200/404 con campos agregados en PEN y sin
 * registros de donantes (CA-09.1, CA-09.2, CA-02.2).
 */
import { errorEnvelopeSchema, projectStatsSchema } from "@donaciones/shared";
import { describe, expect, it } from "vitest";
import { createGetProjectStatsHandler } from "../../src/projects/handlers/getProjectStats";
import { createProjectsRepository } from "../../src/projects/repository";
import { createLogger } from "../../src/shared/logger";
import { createFakeProjectsDynamo } from "../helpers/fakeDynamo";
import {
  ALL_DONATIONS,
  ALL_PROJECTS,
  DRAFT_PROJECT_ID,
  MISSING_PROJECT_ID,
  PUBLISHED_PROJECT_ID,
} from "../helpers/fixtures";
import { loadOpenApi } from "../helpers/openapi";
import { buildJwtEvent } from "../helpers/setup";

const handler = createGetProjectStatsHandler({
  repository: createProjectsRepository(createFakeProjectsDynamo(ALL_PROJECTS), "testProjects"),
  createLogger: (id) => createLogger(id, { sink: () => {} }),
});
const get = (projectId: string) =>
  handler(buildJwtEvent({ authorizer: false, pathParameters: { projectId } }));

describe("GET /v1/projects/{projectId}/stats → 200", () => {
  it("devuelve los indicadores agregados con el esquema ProjectStats", async () => {
    const response = await get(PUBLISHED_PROJECT_ID);
    expect(response.statusCode).toBe(200);
    expect(response.headers?.["content-type"]).toBe("application/json; charset=utf-8");
    const body = JSON.parse(response.body as string);
    expect(projectStatsSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      projectId: PUBLISHED_PROJECT_ID,
      goalAmountCents: 500_000,
      confirmedAmountCents: 10_000,
      currency: "PEN",
    });
  });

  it("los campos agregados son enteros en céntimos de PEN", async () => {
    const body = JSON.parse((await get(PUBLISHED_PROJECT_ID)).body as string);
    expect(Number.isInteger(body.goalAmountCents)).toBe(true);
    expect(Number.isInteger(body.confirmedAmountCents)).toBe(true);
    expect(body.currency).toBe("PEN");
  });

  it("no incluye donantes ni registros individuales de donaciones", async () => {
    const text = (await get(PUBLISHED_PROJECT_ID)).body as string;
    for (const donation of ALL_DONATIONS) {
      expect(text).not.toContain(donation.donorSub);
      expect(text).not.toContain(donation.donationId);
    }
    expect(text).not.toMatch(/donor|donation|createdBySub|idempotency/i);
  });
});

describe("GET /v1/projects/{projectId}/stats → 404", () => {
  it.each([
    ["inexistente", MISSING_PROJECT_ID],
    ["BORRADOR", DRAFT_PROJECT_ID],
    ["malformado", "no-es-uuid"],
  ])("un proyecto %s responde 404 con el sobre de error uniforme", async (_label, id) => {
    const response = await get(id);
    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body as string);
    expect(errorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("el 404 es idéntico para inexistente, borrador y malformado", async () => {
    const bodies = await Promise.all([MISSING_PROJECT_ID, DRAFT_PROJECT_ID, "x"].map(get));
    expect(new Set(bodies.map((r) => r.body)).size).toBe(1);
  });
});

describe("coincide con contracts/openapi.yaml", () => {
  const openapi = loadOpenApi();

  it("ProjectStats tiene las mismas propiedades que la respuesta", async () => {
    const body = JSON.parse((await get(PUBLISHED_PROJECT_ID)).body as string);
    const stats = openapi.components.schemas.ProjectStats!;
    expect(Object.keys(stats.properties!).sort()).toEqual(Object.keys(body).sort());
    expect([...stats.required!].sort()).toEqual(Object.keys(body).sort());
    expect(stats.additionalProperties).toBe(false);
  });

  it("la operación es pública y declara 200, 404 y 500", () => {
    const operation = openapi.paths["/v1/projects/{projectId}/stats"]!.get as unknown as {
      security: unknown[];
      responses: Record<string, unknown>;
    };
    expect(operation.security).toEqual([]);
    expect(Object.keys(operation.responses).sort()).toEqual(["200", "404", "500"]);
  });
});
