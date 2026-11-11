/**
 * T036 — Contrato de `GET /v1/projects`: 200 con solo resúmenes PUBLICADO y sin identificadores de
 * donantes (CA-01.1, CA-01.2, CA-09.2). Se ejecuta el handler contra un doble de DynamoDB con
 * publicados y borradores, y se compara con contracts/openapi.yaml.
 */
import { errorEnvelopeSchema, projectSummarySchema } from "@donaciones/shared";
import { describe, expect, it } from "vitest";
import { createListProjectsHandler } from "../../src/projects/handlers/listProjects";
import { createProjectsRepository } from "../../src/projects/repository";
import { createLogger } from "../../src/shared/logger";
import { createFakeProjectsDynamo } from "../helpers/fakeDynamo";
import {
  ALL_DONATIONS,
  DRAFT_PROJECT_ID,
  makeProject,
  PUBLISHED_PROJECT_ID,
} from "../helpers/fixtures";
import { loadOpenApi } from "../helpers/openapi";
import { buildJwtEvent, createRecordingClient } from "../helpers/setup";
import { ALL_PROJECTS } from "../helpers/fixtures";

const MORE = [
  makeProject({
    projectId: "00000000-0000-4000-8000-000000000010",
    title: "Comedor solidario",
    createdAt: "2026-11-03T10:00:00.000Z",
    confirmedAmountCents: 0,
  }),
  makeProject({
    projectId: "00000000-0000-4000-8000-000000000011",
    title: "Otro borrador",
    status: "BORRADOR",
    createdAt: "2026-11-04T10:00:00.000Z",
  }),
];

function handlerOver(items: readonly object[]) {
  const client = createFakeProjectsDynamo(items);
  return createListProjectsHandler({
    repository: createProjectsRepository(client, "testProjects"),
    createLogger: (id) => createLogger(id, { sink: () => {} }),
  });
}
const invoke = (items: readonly object[], query?: Record<string, string>) =>
  handlerOver(items)(buildJwtEvent({ authorizer: false, query }));

describe("GET /v1/projects → 200", () => {
  it("responde 200 con JSON y cabeceras seguras", async () => {
    const response = await invoke([...ALL_PROJECTS, ...MORE]);
    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
  });

  it("el cuerpo cumple el esquema ProjectList (arreglo de ProjectSummary)", async () => {
    const body = JSON.parse((await invoke([...ALL_PROJECTS, ...MORE])).body as string);
    expect(Array.isArray(body)).toBe(true);
    for (const item of body) {
      expect(projectSummarySchema.safeParse(item).success).toBe(true);
    }
  });

  it("solo incluye proyectos PUBLICADO: los borradores nunca aparecen", async () => {
    const body = JSON.parse((await invoke([...ALL_PROJECTS, ...MORE])).body as string);
    const ids = body.map((p: { projectId: string }) => p.projectId);
    expect(ids).toContain(PUBLISHED_PROJECT_ID);
    expect(ids).toContain("00000000-0000-4000-8000-000000000010");
    expect(ids).not.toContain(DRAFT_PROJECT_ID);
    expect(ids).not.toContain("00000000-0000-4000-8000-000000000011");
    expect(body).toHaveLength(2);
  });

  it("incluye nombre, finalidad, meta en PEN y suma confirmada simulada (CA-01.1)", async () => {
    const [first] = JSON.parse((await invoke([...ALL_PROJECTS])).body as string);
    expect(first).toMatchObject({
      title: expect.any(String),
      description: expect.any(String),
      goalAmountCents: 500_000,
      confirmedAmountCents: 10_000,
      currency: "PEN",
    });
  });

  it("los importes viajan como enteros, nunca como texto ni decimales", async () => {
    const body = JSON.parse((await invoke([...ALL_PROJECTS, ...MORE])).body as string);
    for (const project of body) {
      expect(Number.isInteger(project.goalAmountCents)).toBe(true);
      expect(Number.isInteger(project.confirmedAmountCents)).toBe(true);
    }
  });

  it("está ordenado del más reciente al más antiguo", async () => {
    const body = JSON.parse((await invoke([...ALL_PROJECTS, ...MORE])).body as string);
    expect(body.map((p: { projectId: string }) => p.projectId)).toEqual([
      "00000000-0000-4000-8000-000000000010",
      PUBLISHED_PROJECT_ID,
    ]);
  });

  it("un catálogo sin publicados es 200 con [] (CA-01.3)", async () => {
    const response = await invoke([ALL_PROJECTS[1]!]);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body as string)).toEqual([]);
  });
});

describe("sin donantes ni registros individuales (CA-09.2)", () => {
  it("ningún elemento incluye identificadores de donantes, donaciones ni datos internos", async () => {
    const text = (await invoke([...ALL_PROJECTS, ...MORE])).body as string;
    for (const donation of ALL_DONATIONS) {
      expect(text).not.toContain(donation.donorSub);
      expect(text).not.toContain(donation.donationId);
    }
    expect(text).not.toMatch(/donor|donation|createdBySub|idempotency|"status"/i);
  });

  it("cada elemento tiene exactamente las claves del esquema ProjectSummary", async () => {
    const body = JSON.parse((await invoke([...ALL_PROJECTS])).body as string);
    const expected = Object.keys(projectSummarySchema.shape).sort();
    for (const item of body) expect(Object.keys(item).sort()).toEqual(expected);
  });
});

describe("coincide con contracts/openapi.yaml", () => {
  const openapi = loadOpenApi();
  const summary = openapi.components.schemas.ProjectSummary!;

  it("las propiedades y requeridos de ProjectSummary son los que devuelve el backend", async () => {
    const [item] = JSON.parse((await invoke([...ALL_PROJECTS])).body as string);
    expect(Object.keys(summary.properties!).sort()).toEqual(Object.keys(item).sort());
    expect([...summary.required!].sort()).toEqual(Object.keys(item).sort());
    expect(summary.additionalProperties).toBe(false);
  });

  it("la operación es pública y declara las respuestas 200, 400 y 500", () => {
    const operation = openapi.paths["/v1/projects"]!.get as unknown as {
      security: unknown[];
      responses: Record<string, unknown>;
    };
    expect(operation.security).toEqual([]);
    expect(Object.keys(operation.responses).sort()).toEqual(["200", "400", "500"]);
  });

  it("los límites de los campos coinciden con las restricciones del contrato", () => {
    const props = summary.properties as Record<string, Record<string, unknown>>;
    expect(props.title).toMatchObject({ minLength: 1, maxLength: 120 });
    expect(props.description).toMatchObject({ minLength: 1, maxLength: 2000 });
    expect(props.goalAmountCents).toMatchObject({ type: "integer", minimum: 1 });
    expect(props.confirmedAmountCents).toMatchObject({ type: "integer", minimum: 0 });
  });
});

describe("errores", () => {
  it("un parámetro de paginación inválido es 400 con el sobre de error uniforme", async () => {
    const response = await invoke([...ALL_PROJECTS], { limit: "-1" });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body as string);
    expect(errorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.code).toBe("INVALID_REQUEST");
  });

  it("un fallo interno es 500 con el sobre de error uniforme y sin detalles", async () => {
    const handler = createListProjectsHandler({
      repository: createProjectsRepository(
        createRecordingClient(() => new Error("table prod-Projects no autorizada")),
        "testProjects",
      ),
      createLogger: (id) => createLogger(id, { sink: () => {} }),
    });
    const response = await handler(buildJwtEvent({ authorizer: false }));
    const body = JSON.parse(response.body as string);
    expect(response.statusCode).toBe(500);
    expect(errorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(response.body).not.toContain("prod-Projects");
  });
});
