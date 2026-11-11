/**
 * T035 — Indicadores agregados públicos: la suma confirmada excluye PENDIENTE_SIMULACION y
 * RECHAZADA_SIMULADA (CA-09.1) y no expone donantes ni registros individuales (CA-09.2);
 * ids inexistentes, no publicados o malformados responden 404 uniforme (CA-02.2).
 */
import { describe, expect, it, vi } from "vitest";
import { createGetProjectStatsHandler } from "../../../src/projects/handlers/getProjectStats";
import { createProjectsRepository } from "../../../src/projects/repository";
import { AppError } from "../../../src/shared/http";
import { createLogger } from "../../../src/shared/logger";
import { createFakeProjectsDynamo } from "../../helpers/fakeDynamo";
import {
  ALL_DONATIONS,
  CONFIRMED_AMOUNT_CENTS,
  DRAFT_PROJECT,
  DRAFT_PROJECT_ID,
  makeProject,
  MISSING_PROJECT_ID,
  PUBLISHED_PROJECT,
  PUBLISHED_PROJECT_ID,
} from "../../helpers/fixtures";
import { buildJwtEvent, createRecordingClient } from "../../helpers/setup";

const TABLE = "testProjects";

function setup(items: readonly Record<string, unknown>[] = [PUBLISHED_PROJECT, DRAFT_PROJECT]) {
  const client = createFakeProjectsDynamo(items);
  const repository = createProjectsRepository(client, TABLE);
  const lines: string[] = [];
  const handler = createGetProjectStatsHandler({
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

describe("suma confirmada (CA-09.1)", () => {
  it("devuelve el acumulado confirmado, no la suma de todas las donaciones", async () => {
    const { call } = setup();
    const body = JSON.parse((await call(PUBLISHED_PROJECT_ID)).body as string);

    const everyDonation = ALL_DONATIONS.filter((d) => d.projectId === PUBLISHED_PROJECT_ID).reduce(
      (sum, d) => sum + d.amountCents,
      0,
    );
    const pendingAndRejected = ALL_DONATIONS.filter(
      (d) => d.projectId === PUBLISHED_PROJECT_ID && d.status !== "CONFIRMADA_SIMULADA",
    ).reduce((sum, d) => sum + d.amountCents, 0);

    expect(pendingAndRejected).toBeGreaterThan(0); // los datos de prueba sí tienen pendientes/rechazadas
    expect(body.confirmedAmountCents).toBe(CONFIRMED_AMOUNT_CENTS);
    expect(body.confirmedAmountCents).not.toBe(everyDonation);
    expect(body.confirmedAmountCents).toBe(everyDonation - pendingAndRejected);
  });

  it("los datos de prueba: ninguna donación pendiente o rechazada integra el acumulado", () => {
    const confirmed = ALL_DONATIONS.filter(
      (d) => d.projectId === PUBLISHED_PROJECT_ID && d.status === "CONFIRMADA_SIMULADA",
    ).reduce((sum, d) => sum + d.amountCents, 0);
    expect(PUBLISHED_PROJECT.confirmedAmountCents).toBe(confirmed);
  });

  it("un proyecto sin donaciones confirmadas muestra 0", async () => {
    const { call } = setup([makeProject({ confirmedAmountCents: 0 })]);
    expect(JSON.parse((await call(PUBLISHED_PROJECT_ID)).body as string).confirmedAmountCents).toBe(0);
  });

  it("lee únicamente la tabla Projects con GetItem: no puede sumar pendientes ni rechazadas", async () => {
    const { client, call } = setup();
    await call(PUBLISHED_PROJECT_ID);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.name).toBe("GetCommand");
    expect(client.calls[0]!.input.TableName).toBe(TABLE);
    expect(client.calls[0]!.input.Key).toEqual({ projectId: PUBLISHED_PROJECT_ID });
  });

  it("los importes son enteros en céntimos de PEN (el formato S/ es solo de presentación)", async () => {
    const { call } = setup();
    const body = JSON.parse((await call(PUBLISHED_PROJECT_ID)).body as string);
    expect(Number.isInteger(body.goalAmountCents)).toBe(true);
    expect(Number.isInteger(body.confirmedAmountCents)).toBe(true);
    expect(body.currency).toBe("PEN");
    expect(JSON.stringify(body)).not.toMatch(/S\//);
  });

  it("conserva importes grandes exactos (sin float)", async () => {
    const { call } = setup([
      makeProject({ goalAmountCents: Number.MAX_SAFE_INTEGER, confirmedAmountCents: Number.MAX_SAFE_INTEGER - 1 }),
    ]);
    const body = JSON.parse((await call(PUBLISHED_PROJECT_ID)).body as string);
    expect(body.goalAmountCents).toBe(Number.MAX_SAFE_INTEGER);
    expect(body.confirmedAmountCents).toBe(Number.MAX_SAFE_INTEGER - 1);
  });
});

describe("sin donantes ni registros individuales (CA-09.2)", () => {
  it("la respuesta contiene exactamente projectId, goalAmountCents, confirmedAmountCents y currency", async () => {
    const { call } = setup();
    const body = JSON.parse((await call(PUBLISHED_PROJECT_ID)).body as string);
    expect(Object.keys(body).sort()).toEqual(
      ["confirmedAmountCents", "currency", "goalAmountCents", "projectId"].sort(),
    );
  });

  it("no filtra atributos internos aunque la base de datos los devuelva", async () => {
    const client = createRecordingClient(() => ({
      Item: {
        ...PUBLISHED_PROJECT,
        donorSub: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        donations: [{ donationId: "d", donorSub: "x", amountCents: 100 }],
        idempotencyKey: "3b241101-e2bb-4255-8caf-4136c566a962",
      },
    }));
    const handler = createGetProjectStatsHandler({
      repository: createProjectsRepository(client, TABLE),
      createLogger: (id) => createLogger(id, { sink: () => {} }),
    });
    const response = await handler(
      buildJwtEvent({ authorizer: false, pathParameters: { projectId: PUBLISHED_PROJECT_ID } }),
    );
    expect(response.body).not.toMatch(/donor|createdBySub|donations|idempotency|donationId/i);
  });

  it("pide solo atributos públicos a la base de datos (nunca createdBySub)", async () => {
    const { client, call } = setup();
    await call(PUBLISHED_PROJECT_ID);
    const names = Object.values(client.calls[0]!.input.ExpressionAttributeNames) as string[];
    expect(names).not.toContain("createdBySub");
  });
});

describe("404 uniforme: inexistente, no publicado o malformado (CA-02.2)", () => {
  it("un id inexistente responde 404", async () => {
    const { call } = setup();
    const response = await call(MISSING_PROJECT_ID);
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body as string)).toMatchObject({ code: "NOT_FOUND" });
  });

  it("un proyecto BORRADOR responde 404 y no revela su contenido", async () => {
    const { call } = setup();
    const response = await call(DRAFT_PROJECT_ID);
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain(DRAFT_PROJECT.title);
    expect(response.body).not.toContain(String(DRAFT_PROJECT.goalAmountCents));
  });

  it("inexistente y borrador producen exactamente la misma respuesta (no se revela su existencia)", async () => {
    const { call } = setup();
    const missing = await call(MISSING_PROJECT_ID);
    const draft = await call(DRAFT_PROJECT_ID);
    expect(draft).toEqual(missing);
  });

  it.each([
    ["undefined", undefined],
    ["vacío", ""],
    ["texto", "abc"],
    ["sin guiones", "000000000000400080000000000001"],
    ["UUID con sufijo", `${PUBLISHED_PROJECT_ID}x`],
    ["UUID con espacio", ` ${PUBLISHED_PROJECT_ID}`],
    ["salto de ruta", "../../etc/passwd"],
    ["inyección tipo NoSQL", '{"$ne":null}'],
    ["inyección tipo SQL", "' OR '1'='1"],
    ["comodín", "*"],
    ["muy largo", "a".repeat(10_000)],
    ["con caracteres nulos", `${PUBLISHED_PROJECT_ID}\u0000`],
    ["unicode", "ñandú"],
  ])("un id malformado (%s) responde 404 sin consultar la base de datos", async (_label, id) => {
    const { call, client } = setup();
    const response = await call(id);
    expect(response.statusCode).toBe(404);
    expect(client.calls).toHaveLength(0);
  });

  it("sin pathParameters responde 404", async () => {
    const { call } = setup();
    const event = buildJwtEvent({ authorizer: false });
    delete (event as { pathParameters?: unknown }).pathParameters;
    expect((await createGetProjectStatsHandler({
      repository: createProjectsRepository(createFakeProjectsDynamo([]), TABLE),
      createLogger: (id) => createLogger(id, { sink: () => {} }),
    })(event)).statusCode).toBe(404);
    expect((await call(undefined)).statusCode).toBe(404);
  });

  it("el id sale solo de la ruta: un parámetro de consulta no lo sustituye", async () => {
    const { call, client } = setup();
    const response = await call(MISSING_PROJECT_ID, { query: { projectId: PUBLISHED_PROJECT_ID } });
    expect(response.statusCode).toBe(404);
    expect(client.calls[0]!.input.Key).toEqual({ projectId: MISSING_PROJECT_ID });
  });

  it("repository.getStats devuelve undefined para borradores e inexistentes", async () => {
    const { repository } = setup();
    expect(await repository.getStats(DRAFT_PROJECT_ID)).toBeUndefined();
    expect(await repository.getStats(MISSING_PROJECT_ID)).toBeUndefined();
    expect(await repository.getStats(PUBLISHED_PROJECT_ID)).toBeDefined();
  });

  it("repository.getProject solo devuelve proyectos PUBLICADO", async () => {
    const { repository } = setup();
    expect(await repository.getProject(DRAFT_PROJECT_ID)).toBeUndefined();
    expect(await repository.getProject(MISSING_PROJECT_ID)).toBeUndefined();
    expect((await repository.getProject(PUBLISHED_PROJECT_ID))?.status).toBe("PUBLICADO");
  });

  it.each([
    ["sin estado", { ...PUBLISHED_PROJECT, status: undefined }],
    ["minúsculas", { ...PUBLISHED_PROJECT, status: "publicado" }],
    ["desconocido", { ...PUBLISHED_PROJECT, status: "ARCHIVADO" }],
  ])("un item con estado %s se trata como no publicado (404)", async (_label, item) => {
    const client = createRecordingClient(() => ({ Item: item }));
    const repository = createProjectsRepository(client, TABLE);
    expect(await repository.getStats(PUBLISHED_PROJECT_ID)).toBeUndefined();
  });
});

describe("integridad y fallos", () => {
  it.each([
    ["meta decimal", { goalAmountCents: 1.5 }],
    ["acumulado decimal", { confirmedAmountCents: 0.1 }],
    ["acumulado negativo", { confirmedAmountCents: -5 }],
    ["acumulado como texto", { confirmedAmountCents: "100" }],
    ["moneda distinta", { currency: "USD" }],
  ])("datos corruptos (%s) → 500 controlado, nunca un valor inventado", async (_label, patch) => {
    const client = createRecordingClient(() => ({ Item: { ...PUBLISHED_PROJECT, ...patch } }));
    const repository = createProjectsRepository(client, TABLE);
    const error = await repository.getStats(PUBLISHED_PROJECT_ID).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(500);
  });

  it("un fallo de DynamoDB responde 500 uniforme sin filtrar detalles", async () => {
    const handler = createGetProjectStatsHandler({
      repository: {
        getStats: vi
          .fn()
          .mockRejectedValue(new Error("arn:aws:dynamodb:us-east-1:123456789012:table/prod-Projects")),
      },
      createLogger: (id) => createLogger(id, { sink: () => {} }),
    });
    const response = await handler(
      buildJwtEvent({ authorizer: false, pathParameters: { projectId: PUBLISHED_PROJECT_ID } }),
    );
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toMatch(/arn:aws|123456789012|prod-Projects/);
  });

  it("es público: ignora la cabecera Authorization y no exige contexto de authorizer", async () => {
    const { call } = setup();
    const plain = await call(PUBLISHED_PROJECT_ID);
    const withHeader = await call(PUBLISHED_PROJECT_ID, { headers: { authorization: "Bearer falso" } });
    expect(plain.statusCode).toBe(200);
    expect(withHeader.body).toBe(plain.body);
  });

  it("registra acción y resultado sin datos de la solicitud", async () => {
    const { call, lines } = setup();
    await call(PUBLISHED_PROJECT_ID, { headers: { authorization: "Bearer SECRETO" } });
    await call(MISSING_PROJECT_ID);
    const [ok, notFound] = lines.map((l) => JSON.parse(l));
    expect(ok).toMatchObject({ action: "getProjectStats", result: "success", statusCode: 200 });
    expect(notFound).toMatchObject({ action: "getProjectStats", result: "denied", statusCode: 404 });
    expect(lines.join("\n")).not.toMatch(/SECRETO|Biblioteca/);
  });
});
