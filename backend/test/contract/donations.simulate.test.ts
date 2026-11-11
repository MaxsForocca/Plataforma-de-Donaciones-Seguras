/**
 * T080 — Contrato de `POST /v1/donations/{donationId}/simulate`: 200/400/401/403/404/409 y existencia
 * únicamente en el stage `academic` (CA-06.1, CA-06.2, FR-017). Handler REAL con el middleware de
 * authz contra el doble de tablas; se compara con contracts/openapi.yaml y con infra/template.yaml.
 */
import { donationSchema, errorEnvelopeSchema, ROLES } from "@donaciones/shared";
import { describe, expect, it } from "vitest";
import { ACTIONS } from "../../src/authz/policies";
import {
  CONFIRMED_DONATION_ID,
  OTHER_DONOR_DONATION_ID,
  PENDING_DONATION_ID,
} from "../helpers/fixtures";
import { loadOpenApi } from "../helpers/openapi";
import { allRoutes, resource, template } from "../helpers/template";
import { makeMemoryWorld, simulateEvent, simulationSeed } from "../helpers/world";

const world = () => makeMemoryWorld(simulationSeed());
const body = (r: { body?: string }) => JSON.parse(r.body as string);

describe("POST /v1/donations/{donationId}/simulate → 200", () => {
  it("devuelve la donación con el esquema Donation y cabeceras seguras", async () => {
    const response = await world().simulateDonation(simulateEvent(PENDING_DONATION_ID));
    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    expect(donationSchema.safeParse(body(response)).success).toBe(true);
    expect(body(response).status).toBe("CONFIRMADA_SIMULADA");
  });

  it("también admite RECHAZADA_SIMULADA", async () => {
    const response = await world().simulateDonation(
      simulateEvent(PENDING_DONATION_ID, "RECHAZADA_SIMULADA"),
    );
    expect(body(response).status).toBe("RECHAZADA_SIMULADA");
  });
});

describe("POST /v1/donations/{donationId}/simulate → errores", () => {
  const cases: [string, ReturnType<typeof simulateEvent>, number][] = [
    ["resultado inválido", simulateEvent(PENDING_DONATION_ID, "PENDIENTE_SIMULACION"), 400],
    [
      "campo extra",
      simulateEvent(PENDING_DONATION_ID, {
        outcome: "CONFIRMADA_SIMULADA",
        amountCents: 1,
      } as never),
      400,
    ],
    [
      "sin token",
      simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA", { authorizer: false }),
      401,
    ],
    [
      "ID token",
      simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA", { tokenUse: "id" }),
      401,
    ],
    [
      "token vencido",
      simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA", { expiresInSeconds: -1 }),
      401,
    ],
    [
      "GESTOR",
      simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA", { groups: ["GESTOR"] }),
      403,
    ],
    [
      "AUDITOR",
      simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA", { groups: ["AUDITOR"] }),
      403,
    ],
    ["donación ajena", simulateEvent(OTHER_DONOR_DONATION_ID), 404],
    ["donación inexistente", simulateEvent("00000000-0000-4000-8000-0000000000ee"), 404],
    ["id malformado", simulateEvent("x"), 404],
    ["estado terminal", simulateEvent(CONFIRMED_DONATION_ID), 409],
  ];

  it.each(cases)("%s → HTTP %i con el sobre uniforme", async (_label, event, status) => {
    const response = await world().simulateDonation(event);
    expect(response.statusCode).toBe(status);
    const envelope = body(response);
    expect(errorEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(envelope.requestId).toBe("req-s");
    expect(Object.keys(envelope).sort()).toEqual(["code", "message", "requestId"]);
  });

  it("los 404 (ajena, inexistente, malformado) son idénticos entre sí", async () => {
    const w = world();
    const bodies = new Set(
      await Promise.all(
        cases
          .filter(([, , s]) => s === 404)
          .map(async ([, e]) => (await w.simulateDonation(e)).body),
      ),
    );
    expect(bodies.size).toBe(1);
  });

  it("los rechazos no revelan roles, ids ni importes", async () => {
    const w = world();
    for (const [, event] of cases.filter(([, , s]) => s >= 401)) {
      const text = (await w.simulateDonation(event)).body as string;
      expect(text).not.toMatch(/GESTOR|DONANTE|AUDITOR|api\/|amountCents|donorSub|simulate/i);
    }
  });
});

describe("coincide con contracts/openapi.yaml", () => {
  const openapi = loadOpenApi();
  const operation = openapi.paths["/v1/donations/{donationId}/simulate"]!.post as unknown as {
    security: Record<string, string[]>[];
    "x-required-group": string;
    "x-stage-availability": string;
    responses: Record<string, unknown>;
  };

  it("declara 200, 400, 401, 403, 404, 409 y 500; exige DONANTE, el scope de la política y el stage academic", () => {
    expect(Object.keys(operation.responses).sort()).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "409",
      "500",
    ]);
    expect(operation["x-required-group"]).toBe("DONANTE");
    expect(operation["x-stage-availability"]).toBe("academic");
    expect(operation.security).toEqual([{ cognitoOAuth: [ACTIONS["donation:simulate"].scope] }]);
  });

  it("DonationSimulateRequest: solo `outcome` con los dos estados terminales, sin campos extra", () => {
    const request = openapi.components.schemas.DonationSimulateRequest!;
    expect(request.additionalProperties).toBe(false);
    expect(request.required).toEqual(["outcome"]);
    const outcome = (request.properties as Record<string, { enum: string[] }>).outcome!;
    expect(outcome.enum).toEqual(["CONFIRMADA_SIMULADA", "RECHAZADA_SIMULADA"]);
  });

  it("el rol que exige el contrato es un rol conocido", () => {
    expect(ROLES).toContain(operation["x-required-group"]);
  });
});

describe("la ruta solo existe en el stage academic (infra/template.yaml)", () => {
  const route = () => allRoutes().find((r) => r.path === "/v1/donations/{donationId}/simulate")!;

  it("la función y su ruta pertenecen a la condición IsAcademicStage", () => {
    expect(resource("SimulateDonationFunction").Condition).toBe("IsAcademicStage");
    expect(route().functionName).toBe("SimulateDonationFunction");
    expect(route().method).toBe("POST");
  });

  it("IsAcademicStage es exactamente Stage == academic", () => {
    expect(
      (template as unknown as { Conditions: Record<string, unknown> }).Conditions.IsAcademicStage,
    ).toEqual(["Stage", "academic"]);
  });

  it("es la ÚNICA función de la plantilla condicionada al stage", () => {
    const conditional = Object.entries(template.Resources)
      .filter(([, r]) => r.Type === "AWS::Serverless::Function" && r.Condition)
      .map(([name]) => name);
    expect(conditional).toEqual(["SimulateDonationFunction"]);
  });

  it("la ruta está protegida con el authorizer JWT y el scope de escritura de donaciones", () => {
    expect(route().auth).toEqual({
      Authorizer: "CognitoJwt",
      AuthorizationScopes: ["api/donations.write"],
    });
  });

  it("ningún otro recurso de la plantilla enlaza la ruta de simulación fuera del stage academic", () => {
    const others = allRoutes().filter(
      (r) => r.path.includes("simulate") && r.functionName !== "SimulateDonationFunction",
    );
    expect(others).toEqual([]);
  });
});
