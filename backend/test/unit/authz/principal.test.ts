import { describe, expect, it } from "vitest";
import { buildPrincipal, parseListClaim, type PrincipalSource } from "../../../src/authz/principal";
import { AppError, toErrorResponse } from "../../../src/shared/http";
import { DONOR_A_SUB, MANAGER_SUB } from "../../helpers/fixtures";
import {
  buildJwtEvent,
  donanteEvent,
  FIXED_NOW_MS,
  gestorEvent,
  TEST_CLIENT_ID,
  TEST_ISSUER,
} from "../../helpers/setup";

const options = { now: () => FIXED_NOW_MS };
const principalOf = (event: PrincipalSource, extra = {}) =>
  buildPrincipal(event, { ...options, ...extra });

function expect401(action: () => unknown) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(401);
    expect((error as AppError).code).toBe("UNAUTHORIZED");
    return;
  }
  throw new Error("Se esperaba un 401");
}

describe("buildPrincipal — identidad solo desde claims verificados (CA-04.3)", () => {
  it("deriva sub, roles, scopes y client_id del contexto del authorizer", () => {
    const principal = principalOf(donanteEvent());
    expect(principal).toEqual({
      sub: DONOR_A_SUB,
      roles: ["DONANTE"],
      scopes: ["api/donations.read", "api/donations.write"],
      clientId: TEST_CLIENT_ID,
    });
  });

  it("devuelve un principal inmutable", () => {
    const principal = principalOf(gestorEvent());
    expect(Object.isFrozen(principal)).toBe(true);
    expect(Object.isFrozen(principal.roles)).toBe(true);
    expect(() => {
      (principal as { sub: string }).sub = "otro";
    }).toThrow(TypeError);
  });

  describe("ignora todo lo que envía el cliente", () => {
    const hostile = {
      sub: "impostor",
      donorSub: "impostor",
      roles: ["GESTOR"],
      groups: ["GESTOR"],
      "cognito:groups": ["GESTOR"],
      scopes: ["api/projects.write"],
    };

    it("body, query, cabeceras y parámetros de ruta no cambian sub ni roles", () => {
      const event = donanteEvent({
        body: hostile,
        query: { donorSub: "impostor", groups: "GESTOR", sub: "impostor" },
        headers: {
          "x-donor-sub": "impostor",
          "x-user-groups": "GESTOR",
          "x-amzn-oidc-identity": "impostor",
          "cognito:groups": "GESTOR",
          authorization: "Bearer falso",
        },
        pathParameters: { donorSub: "impostor" },
      });
      const principal = principalOf(event);
      expect(principal.sub).toBe(DONOR_A_SUB);
      expect(principal.roles).toEqual(["DONANTE"]);
      expect(principal.scopes).not.toContain("api/projects.write");
    });

    it("solo lee requestContext (los getters de body/headers/query lanzarían error)", () => {
      const accessed: string[] = [];
      const target = donanteEvent({ body: hostile, headers: { "x-donor-sub": "impostor" } });
      const spy = new Proxy(target, {
        get(object, property, receiver) {
          accessed.push(String(property));
          return Reflect.get(object, property, receiver);
        },
      });
      principalOf(spy);
      expect(accessed).toEqual(["requestContext"]);
    });

    it("no toma roles de claims personalizados ni de otros claims", () => {
      const principal = principalOf(
        buildJwtEvent({
          groups: null,
          scopes: ["api/donations.write"],
          claims: { "custom:role": "GESTOR", role: "GESTOR", groups: "GESTOR", roles: "GESTOR" },
        }),
      );
      expect(principal.roles).toEqual([]);
    });
  });

  describe("roles (cognito:groups)", () => {
    it.each([
      ["texto de HTTP API con un grupo", "[GESTOR]", ["GESTOR"]],
      ["texto de HTTP API con varios grupos", "[GESTOR DONANTE]", ["GESTOR", "DONANTE"]],
      ["JSON", '["AUDITOR","GESTOR"]', ["AUDITOR", "GESTOR"]],
      ["grupo único sin corchetes", "GESTOR", ["GESTOR"]],
      ["separado por comas", "[GESTOR,AUDITOR]", ["GESTOR", "AUDITOR"]],
      ["arreglo real", ["DONANTE"], ["DONANTE"]],
      ["duplicados", "[GESTOR GESTOR]", ["GESTOR"]],
      ["grupos desconocidos se descartan", "[ADMIN DONANTE ROOT]", ["DONANTE"]],
      ["distingue mayúsculas (gestor ≠ GESTOR)", "[gestor Donante]", []],
      ["lista vacía", "[]", []],
      ["texto vacío", "", []],
    ])("%s", (_label, groups, expected) => {
      const principal = principalOf(buildJwtEvent({ groups: groups as string | string[] }));
      expect(principal.roles).toEqual(expected);
    });

    it("sin claim de grupos el principal no tiene roles", () => {
      expect(principalOf(buildJwtEvent({ groups: null })).roles).toEqual([]);
    });

    it("un claim de grupos con tipo inesperado no concede roles", () => {
      const event = buildJwtEvent({ claims: { "cognito:groups": 42 } });
      expect(principalOf(event).roles).toEqual([]);
    });
  });

  describe("scopes", () => {
    it("usa jwt.scopes del authorizer", () => {
      const principal = principalOf(buildJwtEvent({ scopes: ["api/donations.read"] }));
      expect(principal.scopes).toEqual(["api/donations.read"]);
    });

    it("si jwt.scopes es null usa el claim scope separado por espacios", () => {
      const principal = principalOf(
        buildJwtEvent({ scopes: null, claims: { scope: "openid api/donations.write" } }),
      );
      expect(principal.scopes).toEqual(["openid", "api/donations.write"]);
    });

    it("sin scopes devuelve una lista vacía", () => {
      expect(
        principalOf(buildJwtEvent({ scopes: null, claims: { scope: undefined } })).scopes,
      ).toEqual([]);
    });
  });

  describe("rechaza con 401 uniforme (CA-03.2)", () => {
    it("solicitud sin contexto del authorizer (sin token)", () => {
      expect401(() => principalOf(buildJwtEvent({ authorizer: false })));
    });

    it.each([
      ["evento vacío", {}],
      ["requestContext vacío", { requestContext: {} }],
      ["authorizer sin jwt", { requestContext: { authorizer: {} } }],
      ["jwt sin claims", { requestContext: { authorizer: { jwt: {} } } }],
    ])("%s", (_label, event) => {
      expect401(() => principalOf(event as PrincipalSource));
    });

    it("ID token usado como access token (token_use=id)", () => {
      expect401(() => principalOf(buildJwtEvent({ tokenUse: "id" })));
    });

    it("sin claim token_use", () => {
      expect401(() => principalOf(buildJwtEvent({ tokenUse: null })));
    });

    it.each(["ACCESS", "Access", "refresh", "", " access"])("token_use=%j", (tokenUse) => {
      expect401(() => principalOf(buildJwtEvent({ tokenUse })));
    });

    it("token de otro cliente (client_id distinto del esperado)", () => {
      expect401(() =>
        principalOf(buildJwtEvent({ clientId: "otro-cliente" }), {
          expectedClientId: TEST_CLIENT_ID,
        }),
      );
    });

    it("sin client_id", () => {
      expect401(() => principalOf(buildJwtEvent({ clientId: null })));
    });

    it("emisor distinto del esperado", () => {
      expect401(() =>
        principalOf(buildJwtEvent({ issuer: "https://evil.example/pool" }), {
          expectedIssuer: TEST_ISSUER,
        }),
      );
    });

    it("sin emisor cuando se espera uno", () => {
      expect401(() =>
        principalOf(buildJwtEvent({ issuer: null }), { expectedIssuer: TEST_ISSUER }),
      );
    });

    it("acepta cuando client_id y emisor coinciden", () => {
      expect(() =>
        principalOf(buildJwtEvent(), {
          expectedClientId: TEST_CLIENT_ID,
          expectedIssuer: TEST_ISSUER,
        }),
      ).not.toThrow();
    });

    it("token expirado", () => {
      expect401(() => principalOf(buildJwtEvent({ expiresInSeconds: -60 })));
    });

    it("token que expira exactamente ahora", () => {
      expect401(() => principalOf(buildJwtEvent({ expiresInSeconds: 0 })));
    });

    it("token que expira dentro de un segundo es válido", () => {
      expect(() => principalOf(buildJwtEvent({ expiresInSeconds: 1 }))).not.toThrow();
    });

    it("sin exp o con exp no numérico", () => {
      expect401(() => principalOf(buildJwtEvent({ expiresInSeconds: null })));
      expect401(() => principalOf(buildJwtEvent({ claims: { exp: "abc" } })));
      expect401(() => principalOf(buildJwtEvent({ claims: { exp: "" } })));
      expect401(() => principalOf(buildJwtEvent({ claims: { exp: "NaN" } })));
      expect401(() => principalOf(buildJwtEvent({ claims: { exp: null } })));
    });

    it.each([
      ["sin sub", undefined],
      ["sub vacío", ""],
      ["sub numérico", 123],
      ["sub con '#' (rompería la clave de idempotencia)", "a#createDonation#b"],
      ["sub con espacios", "a b"],
      ["sub con salto de línea", "abc\n"],
      ["sub demasiado largo", "a".repeat(129)],
      ["sub con caracteres no ASCII", "usuário"],
    ])("%s", (_label, sub) => {
      expect401(() => principalOf(buildJwtEvent({ claims: { sub } })));
    });

    it("acepta un sub de 128 caracteres y uno con formato UUID", () => {
      expect(() => principalOf(buildJwtEvent({ sub: "a".repeat(128) }))).not.toThrow();
      expect(principalOf(buildJwtEvent({ sub: MANAGER_SUB })).sub).toBe(MANAGER_SUB);
    });

    it("la respuesta no revela el motivo del rechazo", () => {
      const bodies = [
        buildJwtEvent({ authorizer: false }),
        buildJwtEvent({ tokenUse: "id" }),
        buildJwtEvent({ expiresInSeconds: -1 }),
      ].map((event) => {
        try {
          principalOf(event);
        } catch (error) {
          const response = toErrorResponse(error, "req-1");
          expect(response.statusCode).toBe(401);
          return response.body;
        }
        throw new Error("Se esperaba un 401");
      });
      expect(new Set(bodies).size).toBe(1);
      expect(bodies[0]).not.toMatch(/token_use|expir|authorizer|sub/i);
    });
  });
});

describe("parseListClaim", () => {
  it.each([
    [undefined, []],
    [null, []],
    [42, []],
    [{}, []],
    [[], []],
    [
      ["a", 1, "b", null],
      ["a", "b"],
    ],
    ["  ", []],
    ["[ ]", []],
    ["[a, b ,c]", ["a", "b", "c"]],
    ['["a"', ['["a"']],
  ])("%j → %j", (input, expected) => {
    expect(parseListClaim(input)).toEqual(expected);
  });
});

describe("T050 (extensión): tokens alterados y casos extremos", () => {
  it.each([
    ["token_use como arreglo", { token_use: ["access"] }],
    ["token_use con espacio", { token_use: "access " }],
    ["client_id como arreglo", { client_id: [TEST_CLIENT_ID] }],
    ["client_id como número", { client_id: 123 }],
    ["sub como objeto", { sub: { toString: (): string => "abc" } }],
    ["sub como arreglo", { sub: ["abc"] }],
    ["exp como arreglo", { exp: [9_999_999_999] }],
    ["exp como objeto", { exp: {} }],
    ["exp negativo", { exp: "-1" }],
    ["exp cero", { exp: "0" }],
    ["exp Infinity", { exp: "Infinity" }],
    ["exp en notación inválida", { exp: "1e" }],
  ])("%s → 401", (_label, claims) => {
    expect401(() => principalOf(buildJwtEvent({ claims })));
  });

  it("acepta exp numérico y exp como texto con espacios (el authorizer ya validó la firma)", () => {
    expect(() => principalOf(buildJwtEvent({ claims: { exp: 9_999_999_999 } }))).not.toThrow();
    expect(() => principalOf(buildJwtEvent({ claims: { exp: " 9999999999 " } }))).not.toThrow();
  });

  it("un emisor con barra final NO coincide (comparación exacta)", () => {
    expect401(() =>
      principalOf(buildJwtEvent({ issuer: `${TEST_ISSUER}/` }), { expectedIssuer: TEST_ISSUER }),
    );
  });

  it("un expectedClientId vacío falla cerrado (ningún token coincide)", () => {
    expect401(() => principalOf(buildJwtEvent(), { expectedClientId: "" }));
  });

  it("un expectedIssuer vacío falla cerrado", () => {
    expect401(() => principalOf(buildJwtEvent(), { expectedIssuer: "" }));
  });

  describe("nombres de grupo que parecen un rol pero no lo son", () => {
    it.each([
      ["espacio de ancho cero", "GESTOR\u200b"],
      ["letras de ancho completo", "ＧＥＳＴＯＲ"],
      ["minúsculas", "gestor"],
      ["capitalizado", "Gestor"],
      ["con prefijo", "XGESTOR"],
      ["con sufijo", "GESTORS"],
      ["homoglifo cirílico (Е)", "GЕSTOR"],
    ])("%s no concede el rol", (_label, group) => {
      expect(principalOf(buildJwtEvent({ groups: [group] })).roles).toEqual([]);
    });

    it("el formato de HTTP API separa los grupos por espacios: un 'nombre' con espacio se lee como dos (Cognito no admite espacios en nombres de grupo)", () => {
      const principal = principalOf(buildJwtEvent({ groups: "[ADMIN GESTOR]" }));
      expect(principal.roles).toEqual(["GESTOR"]);
    });

    it("un espacio no separable (NBSP) alrededor del nombre se descarta como separador", () => {
      expect(principalOf(buildJwtEvent({ groups: "[\u00a0GESTOR\u00a0]" })).roles).toEqual([
        "GESTOR",
      ]);
    });
  });

  it("una lista enorme de grupos (10 000) se procesa rápido y solo conserva los roles válidos", () => {
    const groups = [...Array.from({ length: 10_000 }, (_, i) => `GRUPO_${i}`), "AUDITOR"];
    const started = performance.now();
    const principal = principalOf(buildJwtEvent({ groups }));
    expect(performance.now() - started).toBeLessThan(500);
    expect(principal.roles).toEqual(["AUDITOR"]);
  });

  describe("scopes", () => {
    it("un elemento del arreglo con espacios NO se parte en varios scopes", () => {
      const principal = principalOf(
        buildJwtEvent({ scopes: ["api/donations.read api/donations.write"] }),
      );
      expect(principal.scopes).toEqual(["api/donations.read api/donations.write"]);
      expect(principal.scopes).not.toContain("api/donations.write");
    });

    it("el claim scope se separa por cualquier espacio en blanco (tab, salto de línea)", () => {
      const principal = principalOf(
        buildJwtEvent({
          scopes: null,
          claims: { scope: "openid\tapi/donations.read\napi/donations.write" },
        }),
      );
      expect(principal.scopes).toEqual(["openid", "api/donations.read", "api/donations.write"]);
    });

    it("elimina duplicados", () => {
      const principal = principalOf(
        buildJwtEvent({ scopes: ["api/donations.read", "api/donations.read"] }),
      );
      expect(principal.scopes).toEqual(["api/donations.read"]);
    });

    it("jwt.scopes vacío NO recurre al claim scope (el authorizer manda)", () => {
      const principal = principalOf(
        buildJwtEvent({ scopes: [], claims: { scope: "api/projects.write" } }),
      );
      expect(principal.scopes).toEqual([]);
    });

    it("los scopes no se infieren de los roles", () => {
      expect(principalOf(buildJwtEvent({ groups: ["GESTOR"], scopes: [] })).scopes).toEqual([]);
    });
  });

  it("el principal no incluye el token ni claims adicionales (no se puede filtrar sin querer)", () => {
    const principal = principalOf(
      donanteEvent({ claims: { email: "persona@example.com", jti: "id-token", custom: "x" } }),
    );
    expect(Object.keys(principal).sort()).toEqual(["clientId", "roles", "scopes", "sub"]);
    expect(JSON.stringify(principal)).not.toMatch(/persona@|id-token/);
  });

  it("CA-03.4 (lado backend): el mismo token se acepta hasta su exp y se rechaza desde ese instante", () => {
    const event = donanteEvent({ expiresInSeconds: 900 });
    expect(() => buildPrincipal(event, { now: () => FIXED_NOW_MS + 899_000 })).not.toThrow();
    expect401(() => buildPrincipal(event, { now: () => FIXED_NOW_MS + 900_000 }));
  });
});
