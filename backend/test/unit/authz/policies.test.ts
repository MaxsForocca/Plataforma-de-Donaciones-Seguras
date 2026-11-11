import { describe, expect, it } from "vitest";
import { buildPrincipal, type Principal } from "../../../src/authz/principal";
import {
  ACTIONS,
  assertOwner,
  authorize,
  authorizeOwned,
  can,
  type Action,
} from "../../../src/authz/policies";
import { AppError, toErrorResponse } from "../../../src/shared/http";
import { DONOR_A_SUB, DONOR_B_SUB } from "../../helpers/fixtures";
import {
  auditorEvent,
  buildJwtEvent,
  donanteEvent,
  FIXED_NOW_MS,
  gestorEvent,
} from "../../helpers/setup";

const principalOf = (event: Parameters<typeof buildPrincipal>[0]): Principal =>
  buildPrincipal(event, { now: () => FIXED_NOW_MS });

const donante = principalOf(donanteEvent());
const gestor = principalOf(gestorEvent());
const auditor = principalOf(auditorEvent());

const ALL_ACTIONS = Object.keys(ACTIONS) as Action[];

function statusOf(action: () => unknown): number {
  try {
    action();
  } catch (error) {
    if (error instanceof AppError) return error.statusCode;
    throw error;
  }
  return 200;
}

describe("RBAC (CA-04.1, CA-04.2)", () => {
  const expected: Record<string, readonly Action[]> = {
    donante: ["donation:create", "donation:simulate", "donation:list-own", "donation:read-own"],
    gestor: ["project:create", "project:publish"],
    auditor: ["audit:read"],
  };
  const principals = { donante, gestor, auditor };

  for (const [name, principal] of Object.entries(principals)) {
    for (const action of ALL_ACTIONS) {
      const allowed = (expected[name] ?? []).includes(action);
      it(`${name} ${allowed ? "puede" : "NO puede"} ${action}`, () => {
        expect(can(principal, action)).toBe(allowed);
        expect(statusOf(() => authorize(principal, action))).toBe(allowed ? 200 : 403);
      });
    }
  }

  it("un DONANTE recibe 403 al crear, modificar o publicar proyectos", () => {
    expect(statusOf(() => authorize(donante, "project:create"))).toBe(403);
    expect(statusOf(() => authorize(donante, "project:publish"))).toBe(403);
  });

  it("un GESTOR recibe 403 al consultar el historial de un donante", () => {
    expect(statusOf(() => authorize(gestor, "donation:list-own"))).toBe(403);
    expect(statusOf(() => authorize(gestor, "donation:read-own"))).toBe(403);
  });

  it("un AUDITOR no puede donar ni gestionar proyectos", () => {
    expect(can(auditor, "donation:create")).toBe(false);
    expect(can(auditor, "project:create")).toBe(false);
  });

  describe("exige también el scope de la acción", () => {
    it("el rol correcto sin el scope correcto es 403", () => {
      const sinScope = principalOf(donanteEvent({ scopes: ["api/donations.read"] }));
      expect(can(sinScope, "donation:list-own")).toBe(true);
      expect(can(sinScope, "donation:create")).toBe(false);
    });

    it("un token sin ningún scope no puede nada, aunque tenga el rol", () => {
      const sinScopes = principalOf(donanteEvent({ scopes: [] }));
      for (const action of ALL_ACTIONS) expect(can(sinScopes, action)).toBe(false);
    });

    it("el scope correcto con un rol distinto sigue siendo 403 (los scopes no sustituyen roles)", () => {
      const donanteConScopeDeGestor = principalOf(
        donanteEvent({ scopes: ["api/projects.write", "api/donations.write"] }),
      );
      expect(can(donanteConScopeDeGestor, "project:create")).toBe(false);
    });

    it("un scope de otro recurso no sirve (p. ej. audit.read para donar)", () => {
      const p = principalOf(donanteEvent({ scopes: ["api/audit.read"] }));
      expect(can(p, "donation:create")).toBe(false);
    });
  });

  describe("denegación por defecto", () => {
    it("un principal sin roles no puede nada", () => {
      const sinRoles = principalOf(
        buildJwtEvent({
          groups: null,
          scopes: [
            "api/projects.write",
            "api/donations.write",
            "api/donations.read",
            "api/audit.read",
          ],
        }),
      );
      for (const action of ALL_ACTIONS) expect(can(sinRoles, action)).toBe(false);
    });

    it("un grupo desconocido no concede nada", () => {
      const admin = principalOf(
        buildJwtEvent({ groups: ["ADMIN"], scopes: ["api/projects.write"] }),
      );
      expect(can(admin, "project:create")).toBe(false);
    });

    it.each(["", "project:delete", "toString", "constructor", "__proto__", "hasOwnProperty"])(
      "una acción desconocida (%j) se deniega",
      (action) => {
        expect(can(gestor, action as Action)).toBe(false);
        expect(statusOf(() => authorize(gestor, action as Action))).toBe(403);
      },
    );

    it("una identidad con varios roles puede lo que cada rol permite (fuera del MVP, pero seguro)", () => {
      const ambos = principalOf(
        buildJwtEvent({
          groups: ["DONANTE", "GESTOR"],
          scopes: ["api/projects.write", "api/donations.write"],
        }),
      );
      expect(can(ambos, "project:create")).toBe(true);
      expect(can(ambos, "donation:create")).toBe(true);
      expect(can(ambos, "audit:read")).toBe(false);
    });
  });

  it("el 403 es uniforme: mismo cuerpo sin importar la acción denegada", () => {
    const bodies = new Set(
      ALL_ACTIONS.filter((action) => !can(donante, action)).map((action) => {
        try {
          authorize(donante, action);
        } catch (error) {
          const response = toErrorResponse(error, "req-1");
          expect(response.statusCode).toBe(403);
          return response.body;
        }
        throw new Error("Se esperaba un 403");
      }),
    );
    expect(bodies.size).toBe(1);
    expect([...bodies][0]).not.toMatch(/project|donation|GESTOR|DONANTE|scope/i);
  });
});

describe("ownership (CA-07.2, prueba BOLA)", () => {
  const own = { donorSub: DONOR_A_SUB };

  it("permite al propietario", () => {
    expect(statusOf(() => assertOwner(donante, own))).toBe(200);
  });

  it("un recurso de otro usuario responde 404", () => {
    expect(statusOf(() => assertOwner(donante, { donorSub: DONOR_B_SUB }))).toBe(404);
  });

  it.each([
    ["inexistente (undefined)", undefined],
    ["inexistente (null)", null],
    ["sin donorSub", {}],
    ["donorSub vacío", { donorSub: "" }],
    ["donorSub no string", { donorSub: 123 }],
    ["donorSub null", { donorSub: null }],
    ["distinto por mayúsculas", { donorSub: DONOR_A_SUB.toUpperCase() }],
    ["distinto por espacios", { donorSub: ` ${DONOR_A_SUB}` }],
    ["prefijo del sub", { donorSub: DONOR_A_SUB.slice(0, -1) }],
  ])("%s → 404", (_label, resource) => {
    expect(statusOf(() => assertOwner(donante, resource as { donorSub?: unknown }))).toBe(404);
  });

  it("ajeno e inexistente producen exactamente la misma respuesta (no se revela existencia)", () => {
    const body = (resource: { donorSub?: unknown } | undefined) => {
      try {
        assertOwner(donante, resource);
      } catch (error) {
        return toErrorResponse(error, "req-1");
      }
      throw new Error("Se esperaba un 404");
    };
    expect(body({ donorSub: DONOR_B_SUB })).toEqual(body(undefined));
  });

  it("la propiedad se decide con el sub del token, no con el contenido de la solicitud", () => {
    const impostor = principalOf(
      donanteEvent({
        sub: DONOR_B_SUB,
        body: { donorSub: DONOR_A_SUB },
        headers: { "x-donor-sub": DONOR_A_SUB },
        query: { donorSub: DONOR_A_SUB },
      }),
    );
    expect(statusOf(() => assertOwner(impostor, own))).toBe(404);
  });
});

describe("authorizeOwned", () => {
  const own = { donorSub: DONOR_A_SUB };
  const foreign = { donorSub: DONOR_B_SUB };

  it("rol, scope y propiedad correctos → permitido", () => {
    expect(statusOf(() => authorizeOwned(donante, "donation:read-own", own))).toBe(200);
  });

  it("propietario con el rol equivocado → 403 (el rol se evalúa antes)", () => {
    const gestorPropietario = principalOf(gestorEvent({ sub: DONOR_A_SUB }));
    expect(statusOf(() => authorizeOwned(gestorPropietario, "donation:read-own", own))).toBe(403);
  });

  it("rol correcto sobre recurso ajeno → 404", () => {
    expect(statusOf(() => authorizeOwned(donante, "donation:simulate", foreign))).toBe(404);
  });

  it("rol correcto sobre recurso inexistente → 404", () => {
    expect(statusOf(() => authorizeOwned(donante, "donation:simulate", undefined))).toBe(404);
  });
});
