/**
 * T070 — Mapeo de resultados de la transacción de creación de donaciones: nueva, misma clave y misma
 * huella (replay), misma clave y huella distinta (409), proyecto inexistente (404, antes de
 * transaccionar), proyecto no PUBLICADO (409), conflictos de transacción con reintento y fallos
 * inesperados (500). Constitución, principio IV: una sola TransactWriteItems, sin lectura-escritura.
 */
import { describe, expect, it, vi } from "vitest";
import { actorRef } from "../../../src/audit/repository";
import { buildIdempotencyRecord } from "../../../src/shared/idempotency";
import { createDonationsRepository } from "../../../src/donations/repository";
import { AppError } from "../../../src/shared/http";
import { createFakeTables } from "../../helpers/fakeTables";
import {
  DONOR_A_SUB,
  DRAFT_PROJECT,
  DRAFT_PROJECT_ID,
  IDEMPOTENCY_KEY_1,
  MISSING_PROJECT_ID,
  PUBLISHED_PROJECT,
  PUBLISHED_PROJECT_ID,
} from "../../helpers/fixtures";
import { createRecordingClient, testConfig } from "../../helpers/setup";

const config = testConfig();
const payload = { projectId: PUBLISHED_PROJECT_ID, amountCents: 2500 };
const ctx = (overrides: Record<string, unknown> = {}) => ({
  donorSub: DONOR_A_SUB,
  requestId: "req-1",
  idempotencyKey: IDEMPOTENCY_KEY_1,
  payload,
  input: payload,
  ...overrides,
});

function setup(options: { projects?: object[]; maxAttempts?: number } = {}) {
  const fake = createFakeTables(config, {
    projects: options.projects ?? [{ ...PUBLISHED_PROJECT }, { ...DRAFT_PROJECT }],
  });
  let counter = 0;
  const sleep = vi.fn(async () => {});
  const repository = createDonationsRepository(fake.client, config.tables, {
    newId: () => `00000000-0000-4000-8000-00000000${String(++counter).padStart(4, "0")}`,
    now: () => new Date("2026-11-11T12:00:00.000Z"),
    sleep,
    maxAttempts: options.maxAttempts,
  });
  return { fake, repository, sleep };
}

const cancel = (...codes: string[]) =>
  Object.assign(new Error("cancelada"), {
    name: "TransactionCanceledException",
    CancellationReasons: codes.map((Code) => ({ Code })),
  });
const failTransactions = (fake: ReturnType<typeof createFakeTables>, errors: Error[]) =>
  fake.injectFault((call) => (call.name === "TransactWriteCommand" ? errors.shift() : undefined));
async function status(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
    return 200;
  } catch (error) {
    if (error instanceof AppError) return error.statusCode;
    throw error;
  }
}

describe("donación nueva", () => {
  it("crea PENDIENTE_SIMULACION con el donorSub del contexto y responde 201", async () => {
    const { repository, fake } = setup();
    const result = await repository.createDonation(ctx());
    expect(result).toMatchObject({ statusCode: 201, replayed: false });
    expect(result.donation).toEqual({
      donationId: "00000000-0000-4000-8000-000000000001",
      projectId: PUBLISHED_PROJECT_ID,
      amountCents: 2500,
      currency: "PEN",
      status: "PENDIENTE_SIMULACION",
      createdAt: "2026-11-11T12:00:00.000Z",
      updatedAt: "2026-11-11T12:00:00.000Z",
    });
    expect(fake.dump("donations")[0]).toMatchObject({
      donorSub: DONOR_A_SUB,
      status: "PENDIENTE_SIMULACION",
    });
  });

  it("la respuesta pública no incluye el donorSub", async () => {
    const { repository } = setup();
    const { donation } = await repository.createDonation(ctx());
    expect(JSON.stringify(donation)).not.toContain(DONOR_A_SUB);
  });

  it("lee el proyecto con ConsistentRead y luego usa UNA TransactWriteItems de cuatro items en orden", async () => {
    const { repository, fake } = setup();
    await repository.createDonation(ctx());
    expect(fake.client.calls.map((c) => c.name)).toEqual(["GetCommand", "TransactWriteCommand"]);
    expect(fake.client.calls[0]!.input.ConsistentRead).toBe(true);

    const items = fake.client.calls[1]!.input.TransactItems as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(items).toHaveLength(4);
    expect(items[0]!.Put).toMatchObject({
      TableName: "testIdempotency",
      ConditionExpression: "attribute_not_exists(pk)",
    });
    expect(items[1]!.Put).toMatchObject({
      TableName: "testDonations",
      ConditionExpression: "attribute_not_exists(donationId)",
    });
    expect(items[2]!.ConditionCheck).toMatchObject({
      TableName: "testProjects",
      Key: { projectId: PUBLISHED_PROJECT_ID },
      ConditionExpression: "#status = :published",
      ExpressionAttributeValues: { ":published": "PUBLICADO" },
    });
    expect(items[3]!.Put.TableName).toBe("testAuditEvents");
  });

  it("nunca lee el registro de idempotencia antes de escribir (sin lectura-luego-escritura)", async () => {
    const { repository, fake } = setup();
    await repository.createDonation(ctx());
    const tablesRead = fake.client.calls
      .filter((c) => c.name === "GetCommand")
      .map((c) => c.input.TableName);
    expect(tablesRead).toEqual(["testProjects"]);
  });

  it("no modifica el proyecto: el acumulado solo cambia al confirmar", async () => {
    const { repository, fake } = setup();
    const before = fake.dump("projects");
    await repository.createDonation(ctx());
    expect(fake.dump("projects")).toEqual(before);
  });

  it("registra DONATION_CREATED con actor seudonimizado, donación como recurso y sin la clave", async () => {
    const { repository, fake } = setup();
    const { donation } = await repository.createDonation(ctx());
    const [event] = fake.dump("audit");
    expect(event).toMatchObject({
      eventType: "DONATION_CREATED",
      resourceRef: donation.donationId,
      action: "createDonation",
      outcome: "SUCCESS",
      requestId: "req-1",
      actorRef: actorRef(DONOR_A_SUB),
    });
    const text = JSON.stringify(event);
    expect(text).not.toContain(DONOR_A_SUB);
    expect(text).not.toContain(IDEMPOTENCY_KEY_1);
  });
});

describe("misma clave y misma huella → replay", () => {
  it("devuelve la donación original, con el estado almacenado y sin crear otra", async () => {
    const { repository, fake } = setup();
    const first = await repository.createDonation(ctx());
    const second = await repository.createDonation(ctx());
    expect(second).toMatchObject({ statusCode: 201, replayed: true });
    expect(second.donation).toEqual(first.donation);
    expect(fake.dump("donations")).toHaveLength(1);
    expect(fake.dump("idempotency")).toHaveLength(1);
    expect(fake.dump("audit")).toHaveLength(1);
  });

  it("tras cancelarse la transacción lee el registro y la donación con ConsistentRead", async () => {
    const { repository, fake } = setup();
    await repository.createDonation(ctx());
    fake.client.calls.length = 0;
    await repository.createDonation(ctx());
    const reads = fake.client.calls.filter((c) => c.name === "GetCommand");
    expect(reads.map((c) => c.input.TableName)).toEqual([
      "testProjects",
      "testIdempotency",
      "testDonations",
    ]);
    expect(reads.slice(1).every((c) => c.input.ConsistentRead === true)).toBe(true);
  });

  it("un replay reusa lo ALMACENADO: otro orden de claves no cambia el resultado", async () => {
    const { repository } = setup();
    const first = await repository.createDonation(ctx());
    const second = await repository.createDonation(
      ctx({ payload: { amountCents: 2500, projectId: PUBLISHED_PROJECT_ID } }),
    );
    expect(second.donation.donationId).toBe(first.donation.donationId);
  });

  it("el replay de otra clave del mismo cuerpo NO es replay: crea una nueva donación", async () => {
    const { repository, fake } = setup();
    await repository.createDonation(ctx());
    await repository.createDonation(
      ctx({ idempotencyKey: "9b2f6c1e-5d0a-4c58-9d3e-0f1d2c3b4a59" }),
    );
    expect(fake.dump("donations")).toHaveLength(2);
  });

  it("si el registro existe pero la donación desapareció, responde 500 (nunca inventa un resultado)", async () => {
    const lost = buildIdempotencyRecord({
      donorSub: DONOR_A_SUB,
      idempotencyKey: IDEMPOTENCY_KEY_1,
      payload,
      donationId: "00000000-0000-4000-8000-0000000000ff",
    });
    const fake = createFakeTables(config, {
      projects: [{ ...PUBLISHED_PROJECT }],
      idempotency: [lost],
    });
    const repository = createDonationsRepository(fake.client, config.tables, {
      sleep: async () => {},
    });
    expect(await status(repository.createDonation(ctx()))).toBe(500);
    expect(fake.dump("donations")).toHaveLength(0);
  });
});

describe("misma clave y huella distinta → 409", () => {
  it.each([
    ["otro importe", { projectId: PUBLISHED_PROJECT_ID, amountCents: 2501 }],
    ["un campo extra", { ...payload, extra: true }],
    ["otro proyecto", { projectId: DRAFT_PROJECT_ID, amountCents: 2500 }],
  ])("%s", async (_label, other) => {
    const { repository, fake } = setup();
    await repository.createDonation(ctx());
    expect(
      await status(
        repository.createDonation(
          ctx({
            payload: other,
            input: { projectId: other.projectId, amountCents: other.amountCents },
          }),
        ),
      ),
    ).toBe(409);
    expect(fake.dump("donations")).toHaveLength(1);
    expect(fake.dump("audit")).toHaveLength(1);
  });
});

describe("proyecto inexistente o no publicado", () => {
  it("inexistente → 404 ANTES de transaccionar (una sola lectura, ninguna escritura)", async () => {
    const { repository, fake } = setup();
    const input = { projectId: MISSING_PROJECT_ID, amountCents: 2500 };
    expect(await status(repository.createDonation(ctx({ payload: input, input })))).toBe(404);
    expect(fake.client.calls.map((c) => c.name)).toEqual(["GetCommand"]);
  });

  it("BORRADOR → 409 por la condición de la transacción, sin dejar nada escrito", async () => {
    const { repository, fake } = setup();
    const input = { projectId: DRAFT_PROJECT_ID, amountCents: 2500 };
    expect(await status(repository.createDonation(ctx({ payload: input, input })))).toBe(409);
    expect(fake.dump("donations")).toHaveLength(0);
    expect(fake.dump("idempotency")).toHaveLength(0); // la clave no queda reservada
    expect(fake.dump("audit")).toHaveLength(0);
  });

  it("tras un 409 por BORRADOR, reintentar la misma clave cuando ya está publicado sí crea la donación", async () => {
    const { repository, fake } = setup();
    const input = { projectId: DRAFT_PROJECT_ID, amountCents: 2500 };
    expect(await status(repository.createDonation(ctx({ payload: input, input })))).toBe(409);
    fake.put("projects", { ...DRAFT_PROJECT, status: "PUBLICADO" }); // el GESTOR lo publica
    const retry = await repository.createDonation(ctx({ payload: input, input }));
    expect(retry).toMatchObject({ statusCode: 201, replayed: false });
    expect(fake.dump("donations")).toHaveLength(1);
  });

  it("el proyecto deja de estar PUBLICADO entre la lectura y la escritura → 409", async () => {
    const { repository, fake } = setup();
    failTransactions(fake, [cancel("None", "None", "ConditionalCheckFailed", "None")]);
    expect(await status(repository.createDonation(ctx()))).toBe(409);
    expect(fake.dump("donations")).toHaveLength(0);
  });

  it("si la clave ya existe Y el proyecto no está publicado, gana el replay/conflicto de la clave", async () => {
    const { repository, fake } = setup();
    await repository.createDonation(ctx());
    failTransactions(fake, [
      cancel("ConditionalCheckFailed", "None", "ConditionalCheckFailed", "None"),
    ]);
    expect((await repository.createDonation(ctx())).replayed).toBe(true);
  });
});

describe("conflictos de transacción y fallos inesperados", () => {
  it("TransactionConflict: reintenta con espera y crea la donación en el segundo intento", async () => {
    const { repository, fake, sleep } = setup();
    failTransactions(fake, [cancel("TransactionConflict", "None", "None", "None")]);
    const result = await repository.createDonation(ctx());
    expect(result).toMatchObject({ statusCode: 201, replayed: false });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(fake.dump("donations")).toHaveLength(1);
  });

  it("tras un TransactionConflict, si otro ya creó la donación con la misma clave → replay", async () => {
    const { repository, fake } = setup();
    await repository.createDonation(ctx());
    failTransactions(fake, [cancel("TransactionConflict", "None", "None", "None")]);
    expect((await repository.createDonation(ctx())).replayed).toBe(true);
    expect(fake.dump("donations")).toHaveLength(1);
  });

  it("conflictos persistentes: se agotan los reintentos y responde 409 (sin efectos)", async () => {
    const { repository, fake, sleep } = setup({ maxAttempts: 3 });
    failTransactions(
      fake,
      Array.from({ length: 5 }, () => cancel("TransactionConflict", "None", "None", "None")),
    );
    expect(await status(repository.createDonation(ctx()))).toBe(409);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(fake.dump("donations")).toHaveLength(0);
  });

  it.each([
    ["ThrottlingError", cancel("ThrottlingError", "None", "None", "None")],
    ["ValidationError", cancel("ValidationError", "None", "None", "None")],
    ["colisión del id de la donación", cancel("None", "ConditionalCheckFailed", "None", "None")],
    [
      "cancelación sin razones",
      Object.assign(new Error("x"), { name: "TransactionCanceledException" }),
    ],
  ])("cancelación inesperada (%s) → 500 sin efectos", async (_label, error) => {
    const { repository, fake } = setup();
    failTransactions(fake, [error]);
    expect(await status(repository.createDonation(ctx()))).toBe(500);
    expect(fake.dump("donations")).toHaveLength(0);
  });

  it("un error de la base de datos (AccessDenied) es un 500 uniforme sin filtrar el mensaje", async () => {
    const client = createRecordingClient(() =>
      Object.assign(
        new Error("User: arn:aws:sts::123456789012:assumed-role/fn is not authorized"),
        { name: "AccessDeniedException" },
      ),
    );
    const repository = createDonationsRepository(client, config.tables);
    const error = (await repository.createDonation(ctx()).catch((e: unknown) => e)) as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(500);
    expect(error.publicMessage).not.toMatch(/arn:aws|123456789012/);
  });

  it("el fallo al leer el proyecto es un 500 uniforme", async () => {
    const client = createRecordingClient(() => new Error("boom"));
    const repository = createDonationsRepository(client, config.tables);
    expect(await status(repository.createDonation(ctx()))).toBe(500);
  });

  it("un proyecto con estado desconocido en la base de datos no acepta donaciones (409)", async () => {
    const { repository } = setup({ projects: [{ ...PUBLISHED_PROJECT, status: "ARCHIVADO" }] });
    expect(await status(repository.createDonation(ctx()))).toBe(409);
  });
});
