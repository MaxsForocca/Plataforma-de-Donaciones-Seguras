/**
 * T095 — Historial propio de donaciones (US8; CA-07.1, CA-07.2):
 * - Consulta filtrada por `donorSub` en el GSI `donorSub-createdAt` (orden descendente por fecha).
 * - Mapea campos públicos (donationId, projectId, amountCents, currency, status, createdAt, updatedAt).
 * - Nunca expone `donorSub` en las respuestas.
 * - Acceso cruzado entre donantes responde 404 uniforme (nunca 403, prueba BOLA).
 * - Lista vacía responde [] con 200 (nunca 404).
 * - Donación inexistente con ID válido responde 404.
 * - Token ausente responde 401; rol incorrecto o scope ausente responde 403.
 */
import { donationSchema } from "@donaciones/shared";
import { describe, expect, it } from "vitest";
import { buildGetDonationHandler } from "../../../src/donations/handlers/getDonation";
import { buildListMyDonationsHandler } from "../../../src/donations/handlers/listMyDonations";
import { createDonationsRepository } from "../../../src/donations/repository";
import { createLogger } from "../../../src/shared/logger";
import { createFakeTables } from "../../helpers/fakeTables";
import {
  CONFIRMED_DONATION,
  DONOR_A_SUB,
  DONOR_B_SUB,
  makeDonation,
  OTHER_DONOR_DONATION,
  OTHER_DONOR_DONATION_ID,
  PENDING_DONATION,
  PENDING_DONATION_ID,
  PUBLISHED_PROJECT,
  REJECTED_DONATION,
} from "../../helpers/fixtures";
import { buildJwtEvent, FIXED_NOW_MS, testConfig } from "../../helpers/setup";

const config = testConfig();
const authConfig = {
  clientId: config.cognito.clientId,
  issuer: config.cognito.issuer,
};

const EXTRA_DONATION_A = makeDonation({
  donationId: "00000000-0000-4000-8000-0000000000d5",
  donorSub: DONOR_A_SUB,
  amountCents: 5_000,
  createdAt: "2026-11-02T10:00:00.000Z",
  status: "CONFIRMADA_SIMULADA",
});

function setup() {
  const fake = createFakeTables(config, {
    projects: [PUBLISHED_PROJECT],
    donations: [
      PENDING_DONATION, // DONOR_A_SUB
      CONFIRMED_DONATION, // DONOR_A_SUB
      REJECTED_DONATION, // DONOR_A_SUB
      OTHER_DONOR_DONATION, // DONOR_B_SUB
      EXTRA_DONATION_A, // DONOR_A_SUB
    ],
  });
  const repository = createDonationsRepository(fake.client, config.tables);
  const lines: string[] = [];
  const logger = (id: string) => createLogger(id, { sink: (l) => lines.push(l) });

  const listHandler = buildListMyDonationsHandler({
    repository,
    config: authConfig,
    createLogger: logger,
    now: () => FIXED_NOW_MS,
  });

  const getHandler = buildGetDonationHandler({
    repository,
    config: authConfig,
    createLogger: logger,
    now: () => FIXED_NOW_MS,
  });

  const callList = (overrides: Parameters<typeof buildJwtEvent>[0] = {}) =>
    listHandler(
      buildJwtEvent({
        sub: DONOR_A_SUB,
        groups: ["DONANTE"],
        scopes: ["api/donations.read"],
        ...overrides,
      }),
    );

  const callGet = (donationId: string | undefined, overrides: Parameters<typeof buildJwtEvent>[0] = {}) =>
    getHandler(
      buildJwtEvent({
        sub: DONOR_A_SUB,
        groups: ["DONANTE"],
        scopes: ["api/donations.read"],
        pathParameters: donationId === undefined ? undefined : { donationId },
        ...overrides,
      }),
    );

  return { fake, repository, lines, listHandler, getHandler, callList, callGet };
}

describe("repositorio: listByDonor y getById (T099)", () => {
  it("listByDonor devuelve solo las donaciones del donante en orden descendente", async () => {
    const { repository } = setup();
    const result = await repository.listByDonor(DONOR_A_SUB);

    expect(result.length).toBe(4);
    // Verificar orden descendente por fecha
    expect(result[0]!.donationId).toBe(EXTRA_DONATION_A.donationId);
    // Cada elemento cumple con donationSchema y no incluye donorSub
    for (const item of result) {
      expect(donationSchema.safeParse(item).success).toBe(true);
      expect(item).not.toHaveProperty("donorSub");
    }
  });

  it("listByDonor devuelve un arreglo vacío [] si el donante no tiene donaciones", async () => {
    const { repository } = setup();
    const result = await repository.listByDonor("00000000-0000-4000-8000-000000000099");
    expect(result).toEqual([]);
  });

  it("getById devuelve la donación pública si pertenece al donante", async () => {
    const { repository } = setup();
    const result = await repository.getById(PENDING_DONATION_ID, DONOR_A_SUB);
    expect(result).toBeDefined();
    expect(result!.donationId).toBe(PENDING_DONATION_ID);
    expect(result!.amountCents).toBe(PENDING_DONATION.amountCents);
    expect(result).not.toHaveProperty("donorSub");
  });

  it("getById devuelve undefined si la donación pertenece a OTRO donante (aislamiento)", async () => {
    const { repository } = setup();
    const result = await repository.getById(OTHER_DONOR_DONATION_ID, DONOR_A_SUB);
    expect(result).toBeUndefined();
  });

  it("getById devuelve undefined si la donación no existe", async () => {
    const { repository } = setup();
    const result = await repository.getById("00000000-0000-4000-8000-0000000000ff", DONOR_A_SUB);
    expect(result).toBeUndefined();
  });
});

describe("handler listMyDonations (GET /v1/donations/me)", () => {
  it("devuelve 200 con el listado de donaciones del donante autenticado", async () => {
    const { callList } = setup();
    const response = await callList();
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body as string);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(4);
    for (const item of body) {
      expect(donationSchema.safeParse(item).success).toBe(true);
      expect(item).not.toHaveProperty("donorSub");
    }
  });

  it("un donante sin donaciones recibe 200 con [] (nunca 404)", async () => {
    const { callList } = setup();
    const response = await callList({ sub: "00000000-0000-4000-8000-000000000099" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("[]");
  });

  it("sin token devuelve 401", async () => {
    const { callList } = setup();
    const response = await callList({ authorizer: false });
    expect(response.statusCode).toBe(401);
  });

  it("con rol no permitido (GESTOR) devuelve 403", async () => {
    const { callList } = setup();
    const response = await callList({ groups: ["GESTOR"] });
    expect(response.statusCode).toBe(403);
  });

  it("sin scope api/donations.read devuelve 403", async () => {
    const { callList } = setup();
    const response = await callList({ scopes: ["api/donations.write"] });
    expect(response.statusCode).toBe(403);
  });

  it("registra en log estructurado la acción listMyDonations con éxito", async () => {
    const { callList, lines } = setup();
    await callList();
    const ok = lines.map((l) => JSON.parse(l)).find((l) => l.action === "listMyDonations");
    expect(ok).toMatchObject({ action: "listMyDonations", result: "success", statusCode: 200 });
  });
});

describe("handler getDonation (GET /v1/donations/{donationId})", () => {
  it("devuelve 200 con la donación propia", async () => {
    const { callGet } = setup();
    const response = await callGet(PENDING_DONATION_ID);
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body as string);
    expect(donationSchema.safeParse(body).success).toBe(true);
    expect(body.donationId).toBe(PENDING_DONATION_ID);
    expect(body).not.toHaveProperty("donorSub");
  });

  it("acceso cruzado: donación de otro donante responde 404 (nunca 403 — prueba BOLA)", async () => {
    const { callGet } = setup();
    // DONOR_A intenta leer la donación de DONOR_B
    const response = await callGet(OTHER_DONOR_DONATION_ID);
    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body as string);
    expect(body.code).toBe("NOT_FOUND");
    expect(response.body).not.toContain(DONOR_B_SUB);
    expect(response.body).not.toContain(OTHER_DONOR_DONATION_ID);
  });

  it("donación inexistente con UUID válido responde 404 uniforme", async () => {
    const { callGet } = setup();
    const response = await callGet("00000000-0000-4000-8000-0000000000ff");
    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body as string);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("id malformado (no UUID) responde 404 sin consultar la base de datos", async () => {
    const { callGet, fake } = setup();
    const response = await callGet("no-es-un-uuid");
    expect(response.statusCode).toBe(404);
    expect(fake.client.calls).toHaveLength(0);
  });

  it("sin pathParameters responde 404", async () => {
    const { callGet } = setup();
    const response = await callGet(undefined);
    expect(response.statusCode).toBe(404);
  });

  it("sin token devuelve 401", async () => {
    const { callGet } = setup();
    const response = await callGet(PENDING_DONATION_ID, { authorizer: false });
    expect(response.statusCode).toBe(401);
  });

  it("con rol no permitido (AUDITOR) devuelve 403", async () => {
    const { callGet } = setup();
    const response = await callGet(PENDING_DONATION_ID, { groups: ["AUDITOR"] });
    expect(response.statusCode).toBe(403);
  });

  it("sin scope api/donations.read devuelve 403", async () => {
    const { callGet } = setup();
    const response = await callGet(PENDING_DONATION_ID, { scopes: ["api/projects.write"] });
    expect(response.statusCode).toBe(403);
  });

  it("el cuerpo de 404 es idéntico entre inexistente, ajena y malformada", async () => {
    const { callGet } = setup();
    const r1 = await callGet("00000000-0000-4000-8000-0000000000ff");
    const r2 = await callGet(OTHER_DONOR_DONATION_ID);
    const r3 = await callGet("malformado");
    expect(new Set([r1.body, r2.body, r3.body]).size).toBe(1);
  });
});
