/**
 * T096 — Contrato de `GET /v1/donations/me` y `GET /v1/donations/{donationId}`:
 * 200/401/403/404 conforme a contracts/openapi.yaml (CA-07.1, CA-07.2).
 */
import { donationSchema, errorEnvelopeSchema } from "@donaciones/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildGetDonationHandler } from "../../src/donations/handlers/getDonation";
import { buildListMyDonationsHandler } from "../../src/donations/handlers/listMyDonations";
import { createDonationsRepository } from "../../src/donations/repository";
import { createLogger } from "../../src/shared/logger";
import { createFakeTables } from "../helpers/fakeTables";
import {
  ALL_DONATIONS,
  ALL_PROJECTS,
  DONOR_A_SUB,
  OTHER_DONOR_DONATION_ID,
  PENDING_DONATION_ID,
} from "../helpers/fixtures";
import { loadOpenApi } from "../helpers/openapi";
import { buildJwtEvent, FIXED_NOW_MS, testConfig } from "../helpers/setup";

const config = testConfig();
const authConfig = {
  clientId: config.cognito.clientId,
  issuer: config.cognito.issuer,
};

const fake = createFakeTables(config, {
  projects: ALL_PROJECTS,
  donations: ALL_DONATIONS,
});
const repository = createDonationsRepository(fake.client, config.tables);
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

const donationListSchema = z.array(donationSchema);

describe("GET /v1/donations/me", () => {
  it("200: responde con el esquema DonationList de openapi", async () => {
    const event = buildJwtEvent({
      sub: DONOR_A_SUB,
      groups: ["DONANTE"],
      scopes: ["api/donations.read"],
    });
    const response = await listHandler(event);
    expect(response.statusCode).toBe(200);
    expect(response.headers?.["content-type"]).toBe("application/json; charset=utf-8");

    const body = JSON.parse(response.body as string);
    expect(donationListSchema.safeParse(body).success).toBe(true);
  });

  it("401: sin token responde con sobre de error UNAUTHORIZED", async () => {
    const event = buildJwtEvent({ authorizer: false });
    const response = await listHandler(event);
    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body as string);
    expect(errorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("403: con rol incorrecto responde con sobre de error FORBIDDEN", async () => {
    const event = buildJwtEvent({
      sub: DONOR_A_SUB,
      groups: ["GESTOR"],
      scopes: ["api/donations.read"],
    });
    const response = await listHandler(event);
    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body as string);
    expect(errorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.code).toBe("FORBIDDEN");
  });

  it("403: con scope incorrecto responde con sobre de error FORBIDDEN", async () => {
    const event = buildJwtEvent({
      sub: DONOR_A_SUB,
      groups: ["DONANTE"],
      scopes: ["api/projects.write"],
    });
    const response = await listHandler(event);
    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body as string);
    expect(errorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.code).toBe("FORBIDDEN");
  });
});

describe("GET /v1/donations/{donationId}", () => {
  it("200: responde con el esquema Donation de openapi para donación propia", async () => {
    const event = buildJwtEvent({
      sub: DONOR_A_SUB,
      groups: ["DONANTE"],
      scopes: ["api/donations.read"],
      pathParameters: { donationId: PENDING_DONATION_ID },
    });
    const response = await getHandler(event);
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body as string);
    expect(donationSchema.safeParse(body).success).toBe(true);
  });

  it("401: sin token responde 401 UNAUTHORIZED", async () => {
    const event = buildJwtEvent({
      authorizer: false,
      pathParameters: { donationId: PENDING_DONATION_ID },
    });
    const response = await getHandler(event);
    expect(response.statusCode).toBe(401);
  });

  it("403: sin rol o scope responde 403 FORBIDDEN", async () => {
    const event = buildJwtEvent({
      sub: DONOR_A_SUB,
      groups: ["AUDITOR"],
      scopes: ["api/donations.read"],
      pathParameters: { donationId: PENDING_DONATION_ID },
    });
    const response = await getHandler(event);
    expect(response.statusCode).toBe(403);
  });

  it("404: donación ajena responde 404 NOT_FOUND (prueba BOLA)", async () => {
    const event = buildJwtEvent({
      sub: DONOR_A_SUB,
      groups: ["DONANTE"],
      scopes: ["api/donations.read"],
      pathParameters: { donationId: OTHER_DONOR_DONATION_ID },
    });
    const response = await getHandler(event);
    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body as string);
    expect(errorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("404: donación inexistente responde 404 NOT_FOUND", async () => {
    const event = buildJwtEvent({
      sub: DONOR_A_SUB,
      groups: ["DONANTE"],
      scopes: ["api/donations.read"],
      pathParameters: { donationId: "00000000-0000-4000-8000-0000000000ff" },
    });
    const response = await getHandler(event);
    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body as string);
    expect(errorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.code).toBe("NOT_FOUND");
  });
});

describe("coincidencia con contracts/openapi.yaml", () => {
  const openapi = loadOpenApi();

  it("/v1/donations/me declara seguridad cognitoOAuth con scope api/donations.read y respuestas 200, 401, 403, 500", () => {
    const op = openapi.paths["/v1/donations/me"]!.get as unknown as {
      security: unknown[];
      responses: Record<string, unknown>;
    };
    expect(op.security).toEqual([{ cognitoOAuth: ["api/donations.read"] }]);
    expect(Object.keys(op.responses).sort()).toEqual(["200", "401", "403", "500"]);
  });

  it("/v1/donations/{donationId} declara seguridad cognitoOAuth y respuestas 200, 401, 403, 404, 500", () => {
    const op = openapi.paths["/v1/donations/{donationId}"]!.get as unknown as {
      security: unknown[];
      responses: Record<string, unknown>;
    };
    expect(op.security).toEqual([{ cognitoOAuth: ["api/donations.read"] }]);
    expect(Object.keys(op.responses).sort()).toEqual(["200", "401", "403", "404", "500"]);
  });
});
