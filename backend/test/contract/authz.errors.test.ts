/**
 * T053 — Contrato de errores de los endpoints protegidos: 401/403/404 con el sobre uniforme
 * `{ code, message, requestId }`, sin filtrar datos, y coherencia entre contracts/openapi.yaml, las
 * políticas del backend (roles y scopes) y las respuestas reales (CA-04.1–CA-04.3, CA-07.2).
 */
import { errorEnvelopeSchema } from "@donaciones/shared";
import { describe, expect, it } from "vitest";
import { withAuth } from "../../src/authz/middleware";
import { ACTIONS, authorizeOwned, type Action } from "../../src/authz/policies";
import { jsonResponse } from "../../src/shared/http";
import { createLogger } from "../../src/shared/logger";
import { DONOR_A_SUB, DONOR_B_SUB, MANAGER_SUB } from "../helpers/fixtures";
import { loadOpenApi } from "../helpers/openapi";
import { buildJwtEvent, FIXED_NOW_MS, TEST_CLIENT_ID, TEST_ISSUER } from "../helpers/setup";

interface OpenApiOperation {
  operationId: string;
  security?: Record<string, string[]>[];
  "x-required-group"?: string;
  responses: Record<string, unknown>;
}

const OPERATION_ACTION: Record<string, Action> = {
  createProject: "project:create",
  publishProject: "project:publish",
  createDonation: "donation:create",
  simulateDonation: "donation:simulate",
  listMyDonations: "donation:list-own",
  getDonation: "donation:read-own",
};
const OWNED = new Set(["getDonation", "simulateDonation"]);

const openapi = loadOpenApi();
const protectedOperations = Object.entries(openapi.paths).flatMap(([path, methods]) =>
  Object.entries(methods)
    .filter(([verb]) => ["get", "post", "patch", "put", "delete"].includes(verb))
    .map(([verb, op]) => ({ path, verb, op: op as unknown as OpenApiOperation }))
    .filter(({ op }) =>
      (op.security ?? []).some((requirement) => Object.keys(requirement).length > 0),
    ),
);

const ALL_SCOPES = [
  "api/projects.write",
  "api/donations.write",
  "api/donations.read",
  "api/audit.read",
];
const GROUP_FOR_ROLE = { DONANTE: DONOR_A_SUB, GESTOR: MANAGER_SUB } as const;

function build(operationId: string) {
  const action = OPERATION_ACTION[operationId]!;
  return withAuth(
    {
      name: operationId,
      action,
      config: { clientId: TEST_CLIENT_ID, issuer: TEST_ISSUER },
      now: () => FIXED_NOW_MS,
      createLogger: (id) => createLogger(id, { sink: () => {} }),
    },
    async ({ event, principal }) => {
      if (OWNED.has(operationId)) {
        const donationId = event.pathParameters?.donationId;
        const stored =
          donationId === "propia" ? { donorSub: principal.sub } : { donorSub: DONOR_B_SUB };
        authorizeOwned(principal, action, donationId === "inexistente" ? undefined : stored);
      }
      return jsonResponse(200, { ok: true });
    },
  );
}

const event = (options: Parameters<typeof buildJwtEvent>[0] = {}) =>
  buildJwtEvent({ scopes: ALL_SCOPES, requestId: "req-contract", ...options });

describe("coherencia del contrato OpenAPI con las políticas del backend", () => {
  it("hay operaciones protegidas y todas están mapeadas a una acción de política", () => {
    expect(protectedOperations.length).toBe(Object.keys(OPERATION_ACTION).length);
    for (const { op } of protectedOperations)
      expect(OPERATION_ACTION[op.operationId]).toBeDefined();
  });

  it.each(
    protectedOperations.map(
      ({ op, path, verb }) => [op.operationId, `${verb.toUpperCase()} ${path}`] as const,
    ),
  )("%s (%s)", (operationId) => {
    const { op } = protectedOperations.find((o) => o.op.operationId === operationId)!;
    const policy = ACTIONS[OPERATION_ACTION[operationId]!];

    // x-required-group y scopes del contrato = política del backend
    expect([op["x-required-group"]]).toEqual([...policy.roles]);
    const scopes = op.security!.flatMap((requirement) => Object.values(requirement).flat());
    expect(scopes).toEqual([policy.scope]);

    // respuestas de error declaradas: 401 (sin/mal token) y 403 (rol/scope) siempre; 404 si hay propiedad
    expect(Object.keys(op.responses)).toEqual(expect.arrayContaining(["401", "403", "500"]));
    if (OWNED.has(operationId)) expect(Object.keys(op.responses)).toContain("404");
  });

  it("el sobre de error del contrato es { code, message, requestId } sin propiedades adicionales", () => {
    const error = openapi.components.schemas.Error!;
    expect([...error.required!].sort()).toEqual(["code", "message", "requestId"]);
    expect(error.additionalProperties).toBe(false);
  });
});

describe.each(protectedOperations.map(({ op }) => op.operationId))(
  "%s: respuestas de error reales",
  (operationId) => {
    const handler = build(operationId);
    const policy = ACTIONS[OPERATION_ACTION[operationId]!];
    const allowedGroup = policy.roles[0]!;
    const wrongGroup = allowedGroup === "DONANTE" ? "GESTOR" : "DONANTE";
    const sub = GROUP_FOR_ROLE[allowedGroup as keyof typeof GROUP_FOR_ROLE] ?? DONOR_A_SUB;
    const path = { pathParameters: { donationId: "ajena" } };

    const cases: [string, ReturnType<typeof buildJwtEvent>, number][] = [
      ["sin token", event({ authorizer: false }), 401],
      ["ID token", event({ sub, groups: [allowedGroup], tokenUse: "id" }), 401],
      ["token vencido", event({ sub, groups: [allowedGroup], expiresInSeconds: -1 }), 401],
      ["token de otro cliente", event({ sub, groups: [allowedGroup], clientId: "otro" }), 401],
      ["rol sin permiso", event({ sub, groups: [wrongGroup] }), 403],
      ["sin roles", event({ sub, groups: null }), 403],
      ["rol correcto sin el scope", event({ sub, groups: [allowedGroup], scopes: [] }), 403],
    ];

    it.each(cases)("%s → HTTP %i con el sobre uniforme", async (_label, ev, status) => {
      const response = await handler({ ...ev, ...path });
      expect(response.statusCode).toBe(status);
      const body = JSON.parse(response.body as string);
      expect(errorEnvelopeSchema.safeParse(body).success).toBe(true);
      expect(body.requestId).toBe("req-contract");
      expect(response.headers).toMatchObject({
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      expect(Object.keys(body).sort()).toEqual(["code", "message", "requestId"]);
    });

    it("los rechazos no revelan roles, scopes, rutas ni identificadores", async () => {
      const texts = await Promise.all(
        cases.map(async ([, ev]) => (await handler({ ...ev, ...path })).body as string),
      );
      for (const text of texts) {
        expect(text).not.toMatch(
          /GESTOR|DONANTE|AUDITOR|api\/|scope|token_use|client_id|donationId|projectId/i,
        );
        expect(text).not.toContain(DONOR_A_SUB);
        expect(text).not.toContain(MANAGER_SUB);
        expect(text).not.toContain(operationId);
      }
    });

    if (OWNED.has(operationId)) {
      it("recurso de otro usuario e inexistente → 404 idéntico (BOLA, CA-07.2)", async () => {
        const own = event({ sub, groups: [allowedGroup] });
        const foreign = await handler({ ...own, pathParameters: { donationId: "ajena" } });
        const missing = await handler({ ...own, pathParameters: { donationId: "inexistente" } });
        expect(foreign.statusCode).toBe(404);
        expect(missing).toEqual(foreign);
        expect(errorEnvelopeSchema.safeParse(JSON.parse(foreign.body as string)).success).toBe(
          true,
        );
      });

      it("el recurso propio sí se entrega", async () => {
        const response = await handler({
          ...event({ sub, groups: [allowedGroup] }),
          pathParameters: { donationId: "propia" },
        });
        expect(response.statusCode).toBe(200);
      });
    }
  },
);

describe("uniformidad entre operaciones", () => {
  const run = async (
    status: 401 | 403,
    make: (op: string, group: string) => ReturnType<typeof buildJwtEvent>,
  ) => {
    const bodies: string[] = [];
    for (const { op } of protectedOperations) {
      const policy = ACTIONS[OPERATION_ACTION[op.operationId]!];
      const group = policy.roles[0]!;
      const response = await build(op.operationId)({
        ...make(op.operationId, group),
        pathParameters: { donationId: "ajena" },
      });
      expect(response.statusCode).toBe(status);
      bodies.push(response.body as string);
    }
    return bodies;
  };

  it("todos los 401 son idénticos entre operaciones y causas", async () => {
    const a = await run(401, () => event({ authorizer: false }));
    const b = await run(401, (_op, group) => event({ groups: [group], tokenUse: "id" }));
    expect(new Set([...a, ...b]).size).toBe(1);
  });

  it("todos los 403 son idénticos entre operaciones y causas (rol, scope, sin roles)", async () => {
    const a = await run(403, (_op, group) =>
      event({ groups: [group === "GESTOR" ? "DONANTE" : "GESTOR"] }),
    );
    const b = await run(403, (_op, group) => event({ groups: [group], scopes: [] }));
    const c = await run(403, () => event({ groups: null }));
    expect(new Set([...a, ...b, ...c]).size).toBe(1);
  });
});
