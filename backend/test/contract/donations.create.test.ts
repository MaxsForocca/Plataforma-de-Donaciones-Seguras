/**
 * T071 — Contrato de `POST /v1/donations`: 201/400/401/403/404/409 con `Idempotency-Key`
 * (CA-05.1–CA-05.5, CA-04.1). Handler REAL con el middleware de authz contra el doble de tablas, y
 * comparación con contracts/openapi.yaml. La matriz genérica de roles vive en authz.roles.test.ts y
 * authz.errors.test.ts; aquí se comprueba el cableado de esta operación.
 */
import {
  AMOUNT_MAX_CENTS,
  AMOUNT_MIN_CENTS,
  donationSchema,
  errorEnvelopeSchema,
} from "@donaciones/shared";
import { describe, expect, it } from "vitest";
import { ACTIONS } from "../../src/authz/policies";
import {
  DONOR_A_SUB,
  DONOR_B_SUB,
  DRAFT_PROJECT,
  DRAFT_PROJECT_ID,
  MISSING_PROJECT_ID,
  PUBLISHED_PROJECT,
  PUBLISHED_PROJECT_ID,
} from "../helpers/fixtures";
import { loadOpenApi } from "../helpers/openapi";
import { auditorEvent, gestorEvent } from "../helpers/setup";
import { DEFAULT_KEY, donationEvent, makeMemoryWorld } from "../helpers/world";

const pid = PUBLISHED_PROJECT_ID;
const valid = { projectId: pid, amountCents: 2500 };
const world = () => makeMemoryWorld({ projects: [{ ...PUBLISHED_PROJECT }, { ...DRAFT_PROJECT }] });
const body = (r: { body?: string }) => JSON.parse(r.body as string);

describe("POST /v1/donations → 201", () => {
  it("devuelve una donación PENDIENTE_SIMULACION con el esquema Donation y cabeceras seguras", async () => {
    const response = await world().createDonation(donationEvent(valid));
    expect(response.statusCode).toBe(201);
    expect(response.headers).toMatchObject({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    const donation = body(response);
    expect(donationSchema.safeParse(donation).success).toBe(true);
    expect(donation).toMatchObject({
      status: "PENDIENTE_SIMULACION",
      amountCents: 2500,
      currency: "PEN",
      projectId: pid,
    });
  });

  it("no expone el donorSub ni datos internos", async () => {
    const response = await world().createDonation(donationEvent(valid));
    expect(response.body).not.toMatch(/donorSub|createdBySub|idempotency|payloadHash/i);
    expect(response.body).not.toContain(DONOR_A_SUB);
  });

  it("un proyecto publicado por OTRO gestor (ajeno al donante) acepta la donación", async () => {
    const ajeno = {
      ...PUBLISHED_PROJECT,
      projectId: "00000000-0000-4000-8000-0000000000aa",
      createdBySub: DONOR_B_SUB,
    };
    const w = makeMemoryWorld({ projects: [ajeno] });
    const response = await w.createDonation(
      donationEvent({ projectId: ajeno.projectId, amountCents: 100 }),
    );
    expect(response.statusCode).toBe(201);
  });

  it("la repetición con la misma clave y el mismo cuerpo devuelve el mismo resultado (201)", async () => {
    const w = world();
    const first = await w.createDonation(donationEvent(valid));
    const second = await w.createDonation(donationEvent(valid));
    expect(second.statusCode).toBe(201);
    expect(second.body).toBe(first.body);
  });
});

describe("POST /v1/donations → 400", () => {
  it.each([
    ["importe 0", { ...valid, amountCents: 0 }, null, "INVALID_AMOUNT"],
    ["importe 99", { ...valid, amountCents: 99 }, null, "INVALID_AMOUNT"],
    ["importe 100001", { ...valid, amountCents: 100_001 }, null, "INVALID_AMOUNT"],
    ["importe decimal", { ...valid, amountCents: 100.5 }, null, "INVALID_AMOUNT"],
    ["importe como texto", { ...valid, amountCents: "2500" }, null, "INVALID_AMOUNT"],
    ["projectId no UUID", { ...valid, projectId: "x" }, null, "INVALID_REQUEST"],
    ["falta projectId", { amountCents: 2500 }, null, "INVALID_REQUEST"],
    ["cuerpo arreglo", [], null, "INVALID_REQUEST"],
  ])("%s → 400 %s", async (_label, payload, _unused, code) => {
    const response = await world().createDonation(donationEvent(payload));
    expect(response.statusCode).toBe(400);
    expect(errorEnvelopeSchema.safeParse(body(response)).success).toBe(true);
    expect(body(response).code).toBe(code);
  });

  it("sin Idempotency-Key → 400 MISSING_IDEMPOTENCY_KEY", async () => {
    const response = await world().createDonation(donationEvent(valid, { key: null }));
    expect(response.statusCode).toBe(400);
    expect(body(response).code).toBe("MISSING_IDEMPOTENCY_KEY");
  });

  it.each(["{", "", "no es json"])("cuerpo no JSON (%j) → 400", async (rawBody) => {
    expect((await world().createDonation(donationEvent(rawBody))).statusCode).toBe(400);
  });
});

describe("POST /v1/donations → 401 y 403", () => {
  const denied: [string, ReturnType<typeof donationEvent>, number][] = [
    ["sin token", donationEvent(valid, { authorizer: false }), 401],
    ["ID token", donationEvent(valid, { tokenUse: "id" }), 401],
    ["token vencido", donationEvent(valid, { expiresInSeconds: -1 }), 401],
    ["token de otro cliente", donationEvent(valid, { clientId: "otro" }), 401],
    [
      "GESTOR",
      gestorEvent({
        method: "POST",
        body: valid,
        scopes: ["api/donations.write"],
        headers: { "idempotency-key": DEFAULT_KEY },
      }),
      403,
    ],
    [
      "AUDITOR",
      auditorEvent({
        method: "POST",
        body: valid,
        scopes: ["api/donations.write"],
        headers: { "idempotency-key": DEFAULT_KEY },
      }),
      403,
    ],
    ["sin grupos", donationEvent(valid, { groups: null }), 403],
    ["DONANTE sin el scope", donationEvent(valid, { scopes: ["api/donations.read"] }), 403],
  ];

  it.each(denied)("%s → HTTP %i, sin tocar la base de datos", async (_label, event, status) => {
    const w = world();
    const response = await w.createDonation(event);
    expect(response.statusCode).toBe(status);
    expect(errorEnvelopeSchema.safeParse(body(response)).success).toBe(true);
    expect(w.calls()).toHaveLength(0);
  });

  it("la autorización va antes que la validación: GESTOR con importe inválido y sin clave recibe 403", async () => {
    const w = world();
    const event = gestorEvent({
      method: "POST",
      body: { amountCents: 0 },
      scopes: ["api/donations.write"],
    });
    expect((await w.createDonation(event)).statusCode).toBe(403);
  });

  it("un GESTOR no puede donar aunque se declare DONANTE en cuerpo, query o cabeceras", async () => {
    const w = world();
    const event = gestorEvent({
      method: "POST",
      scopes: ["api/donations.write"],
      body: { ...valid, roles: ["DONANTE"], groups: ["DONANTE"], donorSub: DONOR_A_SUB },
      query: { role: "DONANTE" },
      headers: { "idempotency-key": DEFAULT_KEY, "x-user-groups": "DONANTE" },
    });
    expect((await w.createDonation(event)).statusCode).toBe(403);
    expect(w.calls()).toHaveLength(0);
  });
});

describe("POST /v1/donations → 404 y 409", () => {
  it("proyecto inexistente → 404 con el sobre uniforme", async () => {
    const response = await world().createDonation(
      donationEvent({ ...valid, projectId: MISSING_PROJECT_ID }),
    );
    expect(response.statusCode).toBe(404);
    expect(body(response).code).toBe("NOT_FOUND");
    expect(errorEnvelopeSchema.safeParse(body(response)).success).toBe(true);
  });

  it("proyecto en BORRADOR → 409 y no se modifica el acumulado", async () => {
    const w = world();
    const before = await w.dump("projects");
    const response = await w.createDonation(
      donationEvent({ ...valid, projectId: DRAFT_PROJECT_ID }),
    );
    expect(response.statusCode).toBe(409);
    expect(body(response).code).toBe("CONFLICT");
    expect(await w.dump("projects")).toEqual(before);
  });

  it("clave reutilizada con otra carga → 409", async () => {
    const w = world();
    await w.createDonation(donationEvent(valid));
    const response = await w.createDonation(donationEvent({ ...valid, amountCents: 2501 }));
    expect(response.statusCode).toBe(409);
    expect(errorEnvelopeSchema.safeParse(body(response)).success).toBe(true);
  });

  it("el 404 de proyecto no revela si el proyecto existe en borrador (409) o no (404) más allá de lo que el contrato define", async () => {
    // El contrato distingue deliberadamente 404 (inexistente) de 409 (no publicado): CA-05.2.
    const w = world();
    expect(
      (await w.createDonation(donationEvent({ ...valid, projectId: MISSING_PROJECT_ID })))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await w.createDonation(
          donationEvent(
            { ...valid, projectId: DRAFT_PROJECT_ID },
            { key: "9b2f6c1e-5d0a-4c58-9d3e-0f1d2c3b4a59" },
          ),
        )
      ).statusCode,
    ).toBe(409);
  });
});

describe("coincide con contracts/openapi.yaml", () => {
  const openapi = loadOpenApi();
  const operation = openapi.paths["/v1/donations"]!.post as unknown as {
    security: Record<string, string[]>[];
    "x-required-group": string;
    parameters: { $ref: string }[];
    responses: Record<string, unknown>;
  };

  it("declara 201, 400, 401, 403, 404, 409 y 500; exige DONANTE y el scope de la política", () => {
    expect(Object.keys(operation.responses).sort()).toEqual([
      "201",
      "400",
      "401",
      "403",
      "404",
      "409",
      "500",
    ]);
    expect(operation["x-required-group"]).toBe("DONANTE");
    expect(operation.security).toEqual([{ cognitoOAuth: [ACTIONS["donation:create"].scope] }]);
  });

  it("Idempotency-Key es una cabecera obligatoria con formato UUID", () => {
    expect(operation.parameters).toEqual([{ $ref: "#/components/parameters/IdempotencyKey" }]);
    const parameter = (
      openapi as unknown as { components: { parameters: Record<string, Record<string, unknown>> } }
    ).components.parameters.IdempotencyKey;
    expect(parameter).toMatchObject({
      in: "header",
      name: "Idempotency-Key",
      required: true,
      schema: { type: "string", format: "uuid" },
    });
  });

  it("DonationCreateRequest: projectId + amountCents obligatorios, importe entero 100–100000, admite campos extra", () => {
    const request = openapi.components.schemas.DonationCreateRequest!;
    expect([...request.required!].sort()).toEqual(["amountCents", "projectId"]);
    expect(request.additionalProperties).toBe(true);
    const props = request.properties as Record<string, Record<string, unknown>>;
    expect(props.amountCents).toMatchObject({
      type: "integer",
      minimum: AMOUNT_MIN_CENTS,
      maximum: AMOUNT_MAX_CENTS,
    });
    expect(Object.keys(request.properties!)).not.toContain("donorSub");
  });

  it("la respuesta tiene exactamente las propiedades del esquema Donation", async () => {
    const donation = body(await world().createDonation(donationEvent(valid)));
    const schema = openapi.components.schemas.Donation!;
    expect(Object.keys(schema.properties!).sort()).toEqual(Object.keys(donation).sort());
    expect([...schema.required!].sort()).toEqual(Object.keys(donation).sort());
    expect(schema.additionalProperties).toBe(false);
  });
});
