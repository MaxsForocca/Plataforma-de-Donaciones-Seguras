/**
 * T097 — Historial de donaciones contra DynamoDB Local: dos donantes distintos solo ven su propio
 * historial y el acceso a un registro ajeno responde 404 uniforme sin revelar su existencia (CA-07.1, CA-07.2).
 * Se omite automáticamente si no existe `DYNAMODB_LOCAL_ENDPOINT`.
 */
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { donationSchema } from "@donaciones/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { buildGetDonationHandler } from "../../src/donations/handlers/getDonation";
import { buildListMyDonationsHandler } from "../../src/donations/handlers/listMyDonations";
import { createDonationsRepository } from "../../src/donations/repository";
import { createLogger } from "../../src/shared/logger";
import {
  ALL_DONATIONS,
  ALL_PROJECTS,
  CONFIRMED_DONATION_ID,
  DONOR_A_SUB,
  DONOR_B_SUB,
  OTHER_DONOR_DONATION_ID,
  PENDING_DONATION_ID,
} from "../helpers/fixtures";
import {
  buildJwtEvent,
  createLocalClients,
  FIXED_NOW_MS,
  hasLocalDynamo,
  isolatedConfig,
  resetTables,
} from "../helpers/setup";

const config = isolatedConfig("history");
const authConfig = {
  clientId: config.cognito.clientId,
  issuer: config.cognito.issuer,
};

describe.skipIf(!hasLocalDynamo())("DynamoDB Local: historial propio y prueba BOLA", () => {
  const { raw, doc } = hasLocalDynamo()
    ? createLocalClients()
    : ({} as ReturnType<typeof createLocalClients>);
  const repository = createDonationsRepository(doc, config.tables);
  const logger = (id: string) => createLogger(id, { sink: () => {} });

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

  beforeAll(async () => {
    await resetTables(raw, config);
    for (const project of ALL_PROJECTS) {
      await doc.send(new PutCommand({ TableName: config.tables.projects, Item: project }));
    }
    for (const donation of ALL_DONATIONS) {
      await doc.send(new PutCommand({ TableName: config.tables.donations, Item: donation }));
    }
  });

  it("el Donante A solo ve sus propias donaciones y no las del Donante B", async () => {
    const response = await listHandler(
      buildJwtEvent({
        sub: DONOR_A_SUB,
        groups: ["DONANTE"],
        scopes: ["api/donations.read"],
      }),
    );
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body as string);
    expect(body.length).toBe(3); // PENDING, CONFIRMED, REJECTED
    const ids = body.map((d: { donationId: string }) => d.donationId);
    expect(ids).toContain(PENDING_DONATION_ID);
    expect(ids).toContain(CONFIRMED_DONATION_ID);
    expect(ids).not.toContain(OTHER_DONOR_DONATION_ID);
    for (const d of body) {
      expect(donationSchema.safeParse(d).success).toBe(true);
      expect(d).not.toHaveProperty("donorSub");
    }
  });

  it("el Donante B solo ve sus propias donaciones", async () => {
    const response = await listHandler(
      buildJwtEvent({
        sub: DONOR_B_SUB,
        groups: ["DONANTE"],
        scopes: ["api/donations.read"],
      }),
    );
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body as string);
    expect(body.length).toBe(1);
    expect(body[0].donationId).toBe(OTHER_DONOR_DONATION_ID);
  });

  it("BOLA: Donante A intentando leer la donación de Donante B recibe 404 (nunca 403)", async () => {
    const response = await getHandler(
      buildJwtEvent({
        sub: DONOR_A_SUB,
        groups: ["DONANTE"],
        scopes: ["api/donations.read"],
        pathParameters: { donationId: OTHER_DONOR_DONATION_ID },
      }),
    );
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain(DONOR_B_SUB);
  });

  it("BOLA: Donante B intentando leer la donación de Donante A recibe 404", async () => {
    const response = await getHandler(
      buildJwtEvent({
        sub: DONOR_B_SUB,
        groups: ["DONANTE"],
        scopes: ["api/donations.read"],
        pathParameters: { donationId: CONFIRMED_DONATION_ID },
      }),
    );
    expect(response.statusCode).toBe(404);
  });
});
