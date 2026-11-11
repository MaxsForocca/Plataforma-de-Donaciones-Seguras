/**
 * T057 — GESTOR con segundo factor (TOTP) obtiene tokens y accede a las operaciones de GESTOR.
 *
 * ALCANCE HONESTO: la emisión de tokens tras TOTP es de Cognito y queda PENDIENTE DE DESPLIEGUE.
 * Aquí se prueba lo que sí es del backend: dado un access token con los claims que Cognito emite para
 * un GESTOR, el backend le concede exactamente las operaciones de GESTOR y ninguna más.
 */
import { describe, expect, it } from "vitest";
import { withAuth } from "../../src/authz/middleware";
import { jsonResponse } from "../../src/shared/http";
import { createLogger } from "../../src/shared/logger";
import { MANAGER_SUB } from "../helpers/fixtures";
import {
  FIXED_NOW_MS,
  gestorEvent,
  TEST_CLIENT_ID,
  TEST_ISSUER,
  auditorEvent,
} from "../helpers/setup";
import type { Action } from "../../src/authz/policies";

const handlerFor = (action: Action) =>
  withAuth(
    {
      name: action,
      action,
      config: { clientId: TEST_CLIENT_ID, issuer: TEST_ISSUER },
      now: () => FIXED_NOW_MS,
      createLogger: (id) => createLogger(id, { sink: () => {} }),
    },
    async ({ principal }) => jsonResponse(200, { sub: principal.sub, roles: principal.roles }),
  );

describe("T057: un GESTOR autenticado (con sus claims de access token)", () => {
  it.each(["project:create", "project:publish"] as const)("puede %s", async (action) => {
    const response = await handlerFor(action)(gestorEvent({ requestId: "r" }));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body as string)).toEqual({ sub: MANAGER_SUB, roles: ["GESTOR"] });
  });

  it.each([
    "donation:create",
    "donation:simulate",
    "donation:list-own",
    "donation:read-own",
    "audit:read",
  ] as const)("NO puede %s", async (action) => {
    const response = await handlerFor(action)(
      gestorEvent({
        scopes: [
          "api/projects.write",
          "api/donations.write",
          "api/donations.read",
          "api/audit.read",
        ],
      }),
    );
    expect(response.statusCode).toBe(403);
  });

  it("un AUDITOR con sus claims puede consultar auditoría y nada más", async () => {
    expect((await handlerFor("audit:read")(auditorEvent())).statusCode).toBe(200);
    expect(
      (await handlerFor("project:create")(auditorEvent({ scopes: ["api/projects.write"] })))
        .statusCode,
    ).toBe(403);
  });

  it("un access token con la identidad de GESTOR pero vencido deja de servir (15 min tras el TOTP)", async () => {
    const response = await handlerFor("project:create")(gestorEvent({ expiresInSeconds: -1 }));
    expect(response.statusCode).toBe(401);
  });
});

describe("PENDIENTE DE DESPLIEGUE (requiere un User Pool de Cognito real)", () => {
  it.todo("un GESTOR que completa TOTP recibe access, ID y refresh token (CA-11.2)");
  it.todo(
    "el access token emitido a un GESTOR trae cognito:groups=[GESTOR], token_use=access y los scopes pedidos",
  );
  it.todo("con ese access token, POST /v1/projects responde 201 a través de API Gateway");
  it.todo("el mismo access token de GESTOR en POST /v1/donations responde 403");
});
