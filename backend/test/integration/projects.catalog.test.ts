/**
 * T038 — Catálogo sembrado contra DynamoDB Local: el GSI devuelve solo PUBLICADO y excluye
 * borradores; las estadísticas respetan la visibilidad. Se omite sin `DYNAMODB_LOCAL_ENDPOINT`.
 */
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { projectSummarySchema } from "@donaciones/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { createGetProjectStatsHandler } from "../../src/projects/handlers/getProjectStats";
import { createListProjectsHandler } from "../../src/projects/handlers/listProjects";
import { createProjectsRepository } from "../../src/projects/repository";
import { createLogger } from "../../src/shared/logger";
import {
  ALL_DONATIONS,
  ALL_PROJECTS,
  DRAFT_PROJECT_ID,
  makeProject,
  MISSING_PROJECT_ID,
  PUBLISHED_PROJECT_ID,
} from "../helpers/fixtures";
import {
  buildJwtEvent,
  createLocalClients,
  hasLocalDynamo,
  isolatedConfig,
  resetTables,
} from "../helpers/setup";

const config = isolatedConfig("catalog");
const EXTRA = [
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

describe.skipIf(!hasLocalDynamo())("DynamoDB Local: catálogo público sembrado", () => {
  const { raw, doc } = hasLocalDynamo()
    ? createLocalClients()
    : ({} as ReturnType<typeof createLocalClients>);
  const repository = createProjectsRepository(doc, config.tables.projects);
  const logger = (id: string) => createLogger(id, { sink: () => {} });
  const list = createListProjectsHandler({ repository, createLogger: logger });
  const stats = createGetProjectStatsHandler({ repository, createLogger: logger });

  beforeAll(async () => {
    await resetTables(raw, config);
    for (const project of [...ALL_PROJECTS, ...EXTRA]) {
      await doc.send(new PutCommand({ TableName: config.tables.projects, Item: project }));
    }
    for (const donation of ALL_DONATIONS) {
      await doc.send(new PutCommand({ TableName: config.tables.donations, Item: donation }));
    }
  });

  it("el listado devuelve solo los proyectos PUBLICADO, del más reciente al más antiguo", async () => {
    const response = await list(buildJwtEvent({ authorizer: false }));
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body as string);
    expect(body.map((p: { projectId: string }) => p.projectId)).toEqual([
      "00000000-0000-4000-8000-000000000010",
      PUBLISHED_PROJECT_ID,
    ]);
  });

  it("los borradores no aparecen aunque existan en la tabla", async () => {
    const body = JSON.parse((await list(buildJwtEvent({ authorizer: false }))).body as string);
    const text = JSON.stringify(body);
    expect(text).not.toContain(DRAFT_PROJECT_ID);
    expect(text).not.toContain("00000000-0000-4000-8000-000000000011");
    expect(text).not.toContain("Huerto escolar");
  });

  it("cada resumen cumple el esquema público y no expone donantes", async () => {
    const response = await list(buildJwtEvent({ authorizer: false }));
    const body = JSON.parse(response.body as string);
    for (const item of body) expect(projectSummarySchema.safeParse(item).success).toBe(true);
    for (const donation of ALL_DONATIONS) {
      expect(response.body).not.toContain(donation.donorSub);
      expect(response.body).not.toContain(donation.donationId);
    }
  });

  it("la proyección real de DynamoDB no trae createdBySub ni fechas", async () => {
    const [first] = JSON.parse((await list(buildJwtEvent({ authorizer: false }))).body as string);
    expect(Object.keys(first).sort()).toEqual(Object.keys(projectSummarySchema.shape).sort());
  });

  it("las estadísticas de un proyecto publicado muestran solo el acumulado confirmado", async () => {
    const response = await stats(
      buildJwtEvent({ authorizer: false, pathParameters: { projectId: PUBLISHED_PROJECT_ID } }),
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body as string)).toEqual({
      projectId: PUBLISHED_PROJECT_ID,
      goalAmountCents: 500_000,
      confirmedAmountCents: 10_000,
      currency: "PEN",
    });
  });

  it.each([
    ["borrador", DRAFT_PROJECT_ID],
    ["inexistente", MISSING_PROJECT_ID],
  ])("las estadísticas de un proyecto %s responden 404", async (_label, projectId) => {
    const response = await stats(
      buildJwtEvent({ authorizer: false, pathParameters: { projectId } }),
    );
    expect(response.statusCode).toBe(404);
  });

  it("un parámetro de paginación inválido es 400 y no devuelve datos", async () => {
    const response = await list(buildJwtEvent({ authorizer: false, query: { limit: "-1" } }));
    expect(response.statusCode).toBe(400);
  });

  it("con la tabla sin proyectos publicados el listado es []", async () => {
    await resetTables(raw, config);
    await doc.send(new PutCommand({ TableName: config.tables.projects, Item: ALL_PROJECTS[1]! }));
    const response = await list(buildJwtEvent({ authorizer: false }));
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("[]");
  });
});
