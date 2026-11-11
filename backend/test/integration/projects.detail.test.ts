/**
 * T090 — Detalle de proyecto contra DynamoDB Local: solo proyectos PUBLICADO responden 200;
 * los borradores y proyectos inexistentes responden 404 uniforme (CA-02.1, CA-02.2).
 * Se omite automáticamente si no existe `DYNAMODB_LOCAL_ENDPOINT`.
 */
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { projectSchema } from "@donaciones/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { createGetProjectHandler } from "../../src/projects/handlers/getProject";
import { createProjectsRepository } from "../../src/projects/repository";
import { createLogger } from "../../src/shared/logger";
import {
  ALL_DONATIONS,
  ALL_PROJECTS,
  DRAFT_PROJECT_ID,
  MANAGER_SUB,
  MISSING_PROJECT_ID,
  PUBLISHED_PROJECT,
  PUBLISHED_PROJECT_ID,
} from "../helpers/fixtures";
import {
  buildJwtEvent,
  createLocalClients,
  hasLocalDynamo,
  isolatedConfig,
  resetTables,
} from "../helpers/setup";

const config = isolatedConfig("detail");

describe.skipIf(!hasLocalDynamo())("DynamoDB Local: detalle público de proyecto", () => {
  const { raw, doc } = hasLocalDynamo()
    ? createLocalClients()
    : ({} as ReturnType<typeof createLocalClients>);
  const repository = createProjectsRepository(doc, config.tables.projects);
  const logger = (id: string) => createLogger(id, { sink: () => {} });
  const detail = createGetProjectHandler({ repository, createLogger: logger });

  beforeAll(async () => {
    await resetTables(raw, config);
    for (const project of ALL_PROJECTS) {
      await doc.send(new PutCommand({ TableName: config.tables.projects, Item: project }));
    }
    for (const donation of ALL_DONATIONS) {
      await doc.send(new PutCommand({ TableName: config.tables.donations, Item: donation }));
    }
  });

  it("el detalle de un proyecto PUBLICADO responde 200 con el esquema completo", async () => {
    const response = await detail(
      buildJwtEvent({ authorizer: false, pathParameters: { projectId: PUBLISHED_PROJECT_ID } }),
    );
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body as string);
    expect(projectSchema.safeParse(body).success).toBe(true);
    expect(body.projectId).toBe(PUBLISHED_PROJECT_ID);
    expect(body.title).toBe(PUBLISHED_PROJECT.title);
    expect(body.status).toBe("PUBLICADO");
  });

  it("el detalle de un proyecto en BORRADOR responde 404", async () => {
    const response = await detail(
      buildJwtEvent({ authorizer: false, pathParameters: { projectId: DRAFT_PROJECT_ID } }),
    );
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("Huerto escolar");
  });

  it("el detalle de un proyecto inexistente responde 404", async () => {
    const response = await detail(
      buildJwtEvent({ authorizer: false, pathParameters: { projectId: MISSING_PROJECT_ID } }),
    );
    expect(response.statusCode).toBe(404);
  });

  it("la proyección de DynamoDB no expone createdBySub ni donantes", async () => {
    const response = await detail(
      buildJwtEvent({ authorizer: false, pathParameters: { projectId: PUBLISHED_PROJECT_ID } }),
    );
    expect(response.body).not.toContain(MANAGER_SUB);
    for (const donation of ALL_DONATIONS) {
      expect(response.body).not.toContain(donation.donorSub);
      expect(response.body).not.toContain(donation.donationId);
    }
  });

  it("un identificador malformado responde 404 sin consultar la tabla", async () => {
    const response = await detail(
      buildJwtEvent({ authorizer: false, pathParameters: { projectId: "no-es-uuid" } }),
    );
    expect(response.statusCode).toBe(404);
  });
});
