/**
 * T088 — Detalle de proyecto público (US2; CA-02.1, CA-02.2):
 * - Devuelve 200 con el esquema Project completo para proyectos PUBLICADO.
 * - Devuelve 404 uniforme para proyectos inexistentes, en BORRADOR o con id malformado (CA-02.2).
 * - Nunca expone datos de donantes ni atributos internos como `createdBySub` (CA-02.1, CA-02.2).
 */
import { projectSchema } from "@donaciones/shared";
import { describe, expect, it, vi } from "vitest";
import { createGetProjectHandler } from "../../../src/projects/handlers/getProject";
import { createProjectsRepository } from "../../../src/projects/repository";
import { AppError } from "../../../src/shared/http";
import { createLogger } from "../../../src/shared/logger";
import { createFakeProjectsDynamo } from "../../helpers/fakeDynamo";
import {
  ALL_DONATIONS,
  CONFIRMED_AMOUNT_CENTS,
  DRAFT_PROJECT,
  DRAFT_PROJECT_ID,
  MANAGER_SUB,
  makeProject,
  MISSING_PROJECT_ID,
  PUBLISHED_PROJECT,
  PUBLISHED_PROJECT_ID,
} from "../../helpers/fixtures";
import { buildJwtEvent, createRecordingClient } from "../../helpers/setup";

const TABLE = "testProjects";

function setup(items: readonly object[] = [PUBLISHED_PROJECT, DRAFT_PROJECT]) {
  const client = createFakeProjectsDynamo(items);
  const repository = createProjectsRepository(client, TABLE);
  const lines: string[] = [];
  const handler = createGetProjectHandler({
    repository,
    createLogger: (id) => createLogger(id, { sink: (l) => lines.push(l) }),
  });
  const call = (projectId: string | undefined, extra: Parameters<typeof buildJwtEvent>[0] = {}) =>
    handler(
      buildJwtEvent({
        authorizer: false,
        pathParameters: projectId === undefined ? undefined : { projectId },
        ...extra,
      }),
    );
  return { client, repository, lines, handler, call };
}

describe("detalle de proyecto publicado (CA-02.1)", () => {
  it("devuelve 200 con el esquema completo de Project", async () => {
    const { call } = setup();
    const response = await call(PUBLISHED_PROJECT_ID);
    expect(response.statusCode).toBe(200);
    expect(response.headers?.["content-type"]).toBe("application/json; charset=utf-8");

    const body = JSON.parse(response.body as string);
    const parsed = projectSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body).toEqual({
      projectId: PUBLISHED_PROJECT_ID,
      title: PUBLISHED_PROJECT.title,
      description: PUBLISHED_PROJECT.description,
      goalAmountCents: PUBLISHED_PROJECT.goalAmountCents,
      confirmedAmountCents: CONFIRMED_AMOUNT_CENTS,
      currency: "PEN",
      status: "PUBLICADO",
      createdAt: PUBLISHED_PROJECT.createdAt,
      updatedAt: PUBLISHED_PROJECT.updatedAt,
    });
  });

  it("los importes son enteros en céntimos de PEN (sin floats ni formato S/)", async () => {
    const { call } = setup();
    const body = JSON.parse((await call(PUBLISHED_PROJECT_ID)).body as string);
    expect(Number.isInteger(body.goalAmountCents)).toBe(true);
    expect(Number.isInteger(body.confirmedAmountCents)).toBe(true);
    expect(body.currency).toBe("PEN");
    expect(JSON.stringify(body)).not.toMatch(/S\//);
  });

  it("conserva importes grandes exactos (sin pérdida por float)", async () => {
    const { call } = setup([
      makeProject({
        goalAmountCents: Number.MAX_SAFE_INTEGER,
        confirmedAmountCents: Number.MAX_SAFE_INTEGER - 1,
      }),
    ]);
    const body = JSON.parse((await call(PUBLISHED_PROJECT_ID)).body as string);
    expect(body.goalAmountCents).toBe(Number.MAX_SAFE_INTEGER);
    expect(body.confirmedAmountCents).toBe(Number.MAX_SAFE_INTEGER - 1);
  });
});

describe("aislamiento y ausencia de datos de donantes (CA-02.1, CA-02.2)", () => {
  it("nunca expone identificadores de donantes ni de donaciones", async () => {
    const { call } = setup();
    const text = (await call(PUBLISHED_PROJECT_ID)).body as string;
    for (const donation of ALL_DONATIONS) {
      expect(text).not.toContain(donation.donorSub);
      expect(text).not.toContain(donation.donationId);
    }
    expect(text).not.toMatch(/donor|donation|idempotency/i);
  });

  it("no expone createdBySub ni metadatos internos del gestor", async () => {
    const { call } = setup();
    const text = (await call(PUBLISHED_PROJECT_ID)).body as string;
    expect(text).not.toContain(MANAGER_SUB);
    expect(text).not.toContain("createdBySub");
    const body = JSON.parse(text);
    expect(body).not.toHaveProperty("createdBySub");
  });

  it("no contiene propiedades adicionales más allá de projectSchema", async () => {
    const { call } = setup();
    const body = JSON.parse((await call(PUBLISHED_PROJECT_ID)).body as string);
    const expectedKeys = [
      "projectId",
      "title",
      "description",
      "goalAmountCents",
      "confirmedAmountCents",
      "currency",
      "status",
      "createdAt",
      "updatedAt",
    ].sort();
    expect(Object.keys(body).sort()).toEqual(expectedKeys);
  });
});

describe("respuestas 404 para proyectos no publicados o inexistentes (CA-02.2)", () => {
  it("devuelve 404 uniforme para proyectos en BORRADOR", async () => {
    const { call } = setup();
    const response = await call(DRAFT_PROJECT_ID);
    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body as string);
    expect(body.code).toBe("NOT_FOUND");
    expect(response.body).not.toContain(DRAFT_PROJECT.title);
  });

  it("devuelve 404 uniforme para proyectos inexistentes", async () => {
    const { call } = setup();
    const response = await call(MISSING_PROJECT_ID);
    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body as string);
    expect(body.code).toBe("NOT_FOUND");
  });

  it.each([
    ["no es uuid", "no-es-uuid"],
    ["uuid vacío", ""],
    ["inyección sql/nosql", "00000000-0000-4000-8000-000000000001' OR 1=1 --"],
    ["ruta con espacios", " 00000000-0000-4000-8000-000000000001 "],
  ])("un id malformado (%s) responde 404 sin consultar DynamoDB", async (_label, id) => {
    const { call, client } = setup();
    const response = await call(id);
    expect(response.statusCode).toBe(404);
    expect(client.calls).toHaveLength(0);
  });

  it("sin pathParameters responde 404 uniforme", async () => {
    const { call } = setup();
    const event = buildJwtEvent({ authorizer: false });
    delete (event as { pathParameters?: unknown }).pathParameters;
    const response = await call(undefined);
    expect(response.statusCode).toBe(404);
  });

  it("el id se extrae exclusivamente de pathParameters: query params no sustituyen el id", async () => {
    const { call, client } = setup();
    const response = await call(MISSING_PROJECT_ID, { query: { projectId: PUBLISHED_PROJECT_ID } });
    expect(response.statusCode).toBe(404);
    expect(client.calls[0]!.input.Key).toEqual({ projectId: MISSING_PROJECT_ID });
  });

  it("el cuerpo del 404 es idéntico entre inexistente, borrador y malformado", async () => {
    const { call } = setup();
    const responses = await Promise.all([
      call(MISSING_PROJECT_ID),
      call(DRAFT_PROJECT_ID),
      call("invalido"),
    ]);
    const bodies = responses.map((r) => r.body);
    expect(new Set(bodies).size).toBe(1);
  });

  it.each([
    ["sin estado", { ...PUBLISHED_PROJECT, status: undefined }],
    ["minúsculas", { ...PUBLISHED_PROJECT, status: "publicado" }],
    ["estado archivado", { ...PUBLISHED_PROJECT, status: "ARCHIVADO" }],
  ])("un proyecto en DynamoDB con %s se trata como no publicado (404)", async (_label, item) => {
    const client = createRecordingClient(() => ({ Item: item }));
    const repository = createProjectsRepository(client, TABLE);
    expect(await repository.getProject(PUBLISHED_PROJECT_ID)).toBeUndefined();
  });
});

describe("integridad, seguridad y fallos", () => {
  it.each([
    ["meta decimal", { goalAmountCents: 100.5 }],
    ["acumulado decimal", { confirmedAmountCents: 0.1 }],
    ["acumulado negativo", { confirmedAmountCents: -50 }],
    ["acumulado como string", { confirmedAmountCents: "100" }],
    ["moneda distinta a PEN", { currency: "USD" }],
    ["título con HTML", { title: "<script>alert(1)</script>" }],
  ])("datos corruptos en DB (%s) lanzan 500 controlado", async (_label, patch) => {
    const client = createRecordingClient(() => ({ Item: { ...PUBLISHED_PROJECT, ...patch } }));
    const repository = createProjectsRepository(client, TABLE);
    const error = await repository
      .getProject(PUBLISHED_PROJECT_ID)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(500);
  });

  it("un error en DynamoDB responde 500 uniforme sin exponer ARNs ni tablas", async () => {
    const handler = createGetProjectHandler({
      repository: {
        getProject: vi
          .fn()
          .mockRejectedValue(
            new Error("arn:aws:dynamodb:us-east-1:123456789012:table/prod-Projects ResourceNotFound"),
          ),
      },
      createLogger: (id) => createLogger(id, { sink: () => {} }),
    });
    const response = await handler(
      buildJwtEvent({ authorizer: false, pathParameters: { projectId: PUBLISHED_PROJECT_ID } }),
    );
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toMatch(/arn:aws|123456789012|prod-Projects/);
  });

  it("es un endpoint público: ignora credenciales falsas en Authorization", async () => {
    const { call } = setup();
    const plain = await call(PUBLISHED_PROJECT_ID);
    const withHeader = await call(PUBLISHED_PROJECT_ID, {
      headers: { authorization: "Bearer token-invalido" },
    });
    expect(plain.statusCode).toBe(200);
    expect(withHeader.body).toBe(plain.body);
  });

  it("registra acción estructurada getProject con resultado success o denied sin secretos", async () => {
    const { call, lines } = setup();
    await call(PUBLISHED_PROJECT_ID, { headers: { authorization: "Bearer TOKEN_SECRETO" } });
    await call(MISSING_PROJECT_ID);

    const [ok, notFound] = lines.map((l) => JSON.parse(l));
    expect(ok).toMatchObject({ action: "getProject", result: "success", statusCode: 200 });
    expect(notFound).toMatchObject({ action: "getProject", result: "denied", statusCode: 404 });
    expect(lines.join("\n")).not.toMatch(/TOKEN_SECRETO/);
  });
});
