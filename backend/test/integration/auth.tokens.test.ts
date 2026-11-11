/**
 * T044 / T046 / T049 — Tokens: ausente, vencido, alterado, de otro cliente o ID token usado como
 * access token → 401 (CA-03.2); vigencia máxima de 15 minutos y authorizer con scopes (CA-03.3);
 * limitación de revocación documentada (CA-03.4).
 *
 * ALCANCE HONESTO: la firma, el emisor, la expiración, la audiencia y los scopes los valida el JWT
 * authorizer de API Gateway ANTES de invocar la Lambda; eso no puede probarse sin desplegar. Aquí se
 * comprueba (1) la configuración del authorizer y de Cognito en la plantilla, (2) la defensa en
 * profundidad del backend ante cualquier contexto que llegara a pasar el authorizer, y (3) que el
 * backend no confía en la cabecera Authorization. Lo que depende de API Gateway/Cognito reales está
 * listado en evidence/auth-pending-deployment.md y NO se da por probado.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACTIONS } from "../../src/authz/policies";
import { buildPrincipal } from "../../src/authz/principal";
import { runHandler } from "../../src/shared/handler";
import { jsonResponse } from "../../src/shared/http";
import { createLogger } from "../../src/shared/logger";
import { DONOR_A_SUB } from "../helpers/fixtures";
import {
  buildJwtEvent,
  createRecordingClient,
  donanteEvent,
  FIXED_NOW_MS,
  TEST_CLIENT_ID,
  TEST_ISSUER,
} from "../helpers/setup";
import { allRoutes, asList, resource, template } from "../helpers/template";

// --- Probe: handler protegido mínimo (lo que hace el middleware de T054) -----------------------

function protectedProbe(now = () => FIXED_NOW_MS) {
  let executed = 0;
  const handler = (event: ReturnType<typeof buildJwtEvent>) =>
    runHandler(
      event,
      "probe",
      { createLogger: (id) => createLogger(id, { sink: () => {} }) },
      async () => {
        const principal = buildPrincipal(event, {
          expectedClientId: TEST_CLIENT_ID,
          expectedIssuer: TEST_ISSUER,
          now,
        });
        executed += 1;
        return jsonResponse(200, { sub: principal.sub });
      },
    );
  return { handler, executed: () => executed };
}

const forgedJwt = (claims: Record<string, unknown>) =>
  [
    "eyJhbGciOiJub25lIn0",
    Buffer.from(JSON.stringify(claims)).toString("base64url"),
    "firma-falsa",
  ].join(".");

describe("CA-03.2: el backend rechaza con 401 uniforme", () => {
  const cases: [string, ReturnType<typeof buildJwtEvent>][] = [
    ["sin token (sin contexto del authorizer)", buildJwtEvent({ authorizer: false })],
    ["token vencido hace 1 segundo", donanteEvent({ expiresInSeconds: -1 })],
    ["token que vence exactamente ahora", donanteEvent({ expiresInSeconds: 0 })],
    ["token vencido hace un año", donanteEvent({ expiresInSeconds: -31_536_000 })],
    ["token sin exp", donanteEvent({ expiresInSeconds: null })],
    ["ID token usado como access token", donanteEvent({ tokenUse: "id" })],
    [
      "ID token con los scopes copiados",
      donanteEvent({ tokenUse: "id", scopes: ["api/donations.write"] }),
    ],
    ["token sin token_use", donanteEvent({ tokenUse: null })],
    ["token emitido para otro cliente", donanteEvent({ clientId: "otro-cliente" })],
    ["token sin client_id", donanteEvent({ clientId: null })],
    [
      "token de otro emisor",
      donanteEvent({ issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_OTRO" }),
    ],
    [
      "emisor con barra final (no coincide exactamente)",
      donanteEvent({ issuer: `${TEST_ISSUER}/` }),
    ],
    ["sub alterado con '#'", donanteEvent({ claims: { sub: `${DONOR_A_SUB}#createDonation#x` } })],
    ["sub vacío", donanteEvent({ claims: { sub: "" } })],
    ["token_use como arreglo", donanteEvent({ claims: { token_use: ["access"] } })],
    ["client_id como arreglo", donanteEvent({ claims: { client_id: [TEST_CLIENT_ID] } })],
    ["exp como texto no numérico", donanteEvent({ claims: { exp: "mañana" } })],
    ["exp booleano", donanteEvent({ claims: { exp: true } })],
  ];

  it.each(cases)("%s → 401 y la lógica de negocio no se ejecuta", async (_label, event) => {
    const { handler, executed } = protectedProbe();
    const response = await handler(event);
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body as string)).toMatchObject({ code: "UNAUTHORIZED" });
    expect(executed()).toBe(0);
  });

  it("todas las causas producen exactamente la misma respuesta (no se revela por qué)", async () => {
    const { handler } = protectedProbe();
    const bodies = new Set(
      (await Promise.all(cases.map(([, event]) => handler(event)))).map((r) => r.body),
    );
    expect(bodies.size).toBe(1);
    expect([...bodies][0]).not.toMatch(/token_use|client_id|exp|issuer|emisor|sub|authorizer/i);
  });

  it("el 401 incluye el desafío WWW-Authenticate: Bearer, sin detalles del motivo", async () => {
    const { handler } = protectedProbe();
    const response = await handler(buildJwtEvent({ authorizer: false }));
    expect(response.headers?.["www-authenticate"]).toBe("Bearer");
  });

  it("un token válido sí ejecuta la lógica", async () => {
    const { handler, executed } = protectedProbe();
    const response = await handler(donanteEvent());
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body as string).sub).toBe(DONOR_A_SUB);
    expect(executed()).toBe(1);
  });
});

describe("token alterado: el backend no confía en la cabecera Authorization", () => {
  it("un JWT falso con roles de GESTOR en la cabecera, sin contexto del authorizer, es 401", async () => {
    const { handler, executed } = protectedProbe();
    const fake = forgedJwt({
      sub: "impostor",
      token_use: "access",
      client_id: TEST_CLIENT_ID,
      iss: TEST_ISSUER,
      exp: Math.floor(FIXED_NOW_MS / 1000) + 900,
      "cognito:groups": ["GESTOR"],
    });
    const response = await handler(
      buildJwtEvent({ authorizer: false, headers: { authorization: `Bearer ${fake}` } }),
    );
    expect(response.statusCode).toBe(401);
    expect(executed()).toBe(0);
  });

  it("una cabecera Authorization falsa no modifica la identidad de un contexto válido", async () => {
    const { handler } = protectedProbe();
    const fake = forgedJwt({ sub: "impostor", token_use: "access" });
    const response = await handler(donanteEvent({ headers: { authorization: `Bearer ${fake}` } }));
    expect(JSON.parse(response.body as string).sub).toBe(DONOR_A_SUB);
  });

  it("claims o grupos enviados en cabeceras, query o cuerpo no cambian la identidad", async () => {
    const { handler } = protectedProbe();
    const response = await handler(
      donanteEvent({
        headers: { "x-amzn-oidc-identity": "impostor", "cognito:groups": "GESTOR" },
        query: { sub: "impostor" },
        body: { sub: "impostor", donorSub: "impostor" },
      }),
    );
    expect(JSON.parse(response.body as string).sub).toBe(DONOR_A_SUB);
  });
});

describe("CA-03.4: un access token revocado se acepta hasta expirar y se rechaza después", () => {
  const claimsExp = 900; // vigencia de la plantilla (15 min)

  it("la decisión del backend depende solo de los claims y del reloj: sin consulta de revocación", async () => {
    const store = createRecordingClient();
    const event = donanteEvent({
      expiresInSeconds: claimsExp,
      claims: { revoked: "true", jti: "tok-1" },
    });
    const base = FIXED_NOW_MS;

    // Mismo token, tres instantes: antes de vencer se acepta (aunque se hubiera revocado en Cognito)...
    expect(() => buildPrincipal(event, { now: () => base })).not.toThrow();
    expect(() => buildPrincipal(event, { now: () => base + (claimsExp - 1) * 1000 })).not.toThrow();
    // ...y al vencer se rechaza.
    expect(() => buildPrincipal(event, { now: () => base + claimsExp * 1000 })).toThrow(
      expect.objectContaining({ statusCode: 401 }),
    );
    expect(store.calls).toHaveLength(0);
  });

  it("la ventana máxima de exposición es la vigencia del access token configurada en Cognito", () => {
    const client = resource("UserPoolClient").Properties;
    expect(client.TokenValidityUnits.AccessToken).toBe("minutes");
    expect(client.AccessTokenValidity).toBeLessThanOrEqual(15);
    expect(claimsExp).toBe(client.AccessTokenValidity * 60);
  });

  it("la limitación está documentada en una sección propia de docs/threat-model.md (T049)", () => {
    const doc = readFileSync(
      fileURLToPath(new URL("../../../docs/threat-model.md", import.meta.url)),
      "utf8",
    );
    // La sección dedicada: un encabezado sobre la revocación y su contenido hasta el siguiente "## ".
    const heading = /^##\s+.*revocaci[oó]n.*$/im.exec(doc);
    expect(heading, "falta un encabezado de sección sobre la revocación").not.toBeNull();
    const rest = doc.slice(heading!.index); // incluye el encabezado
    const next = rest.slice(heading![0].length).search(/^## /m);
    const section = next === -1 ? rest : rest.slice(0, heading![0].length + next);

    expect(section).toMatch(/CA-03\.4/);
    expect(section).toMatch(/hasta (que )?expir/i);
    expect(section).toMatch(/JWT authorizer/i);
    expect(section).toMatch(/refresh token/i);
    expect(section).toMatch(
      new RegExp(`${resource("UserPoolClient").Properties.AccessTokenValidity}\\s*minutos`),
    );
    expect(section).toMatch(/pendiente de despliegue/i);
  });
});

describe("T046: configuración de Cognito y del authorizer (estática)", () => {
  const client = () => resource("UserPoolClient").Properties;
  const authorizer = () =>
    resource("HttpApi").Properties.Auth.Authorizers.CognitoJwt as {
      IdentitySource: string;
      JwtConfiguration: { issuer: string; audience: string[] };
    };

  describe("access token (CA-03.3)", () => {
    it("vigencia entre 5 y 15 minutos, en minutos", () => {
      expect(client().TokenValidityUnits.AccessToken).toBe("minutes");
      expect(client().AccessTokenValidity).toBeGreaterThanOrEqual(5);
      expect(client().AccessTokenValidity).toBeLessThanOrEqual(15);
      expect(Number.isInteger(client().AccessTokenValidity)).toBe(true);
    });

    it("el ID token tampoco supera los 15 minutos", () => {
      expect(client().TokenValidityUnits.IdToken).toBe("minutes");
      expect(client().IdTokenValidity).toBeLessThanOrEqual(15);
    });

    it("el refresh token es revocable y de vida acotada", () => {
      expect(client().EnableTokenRevocation).toBe(true);
      expect(client().TokenValidityUnits.RefreshToken).toBe("days");
      expect(client().RefreshTokenValidity).toBeGreaterThanOrEqual(1);
      expect(client().RefreshTokenValidity).toBeLessThanOrEqual(30);
    });
  });

  describe("Authorization Code + PKCE (CA-03.1)", () => {
    it("solo el flujo 'code': no hay flujo implícito ni client_credentials", () => {
      expect(client().AllowedOAuthFlows).toEqual(["code"]);
      expect(client().AllowedOAuthFlowsUserPoolClient).toBe(true);
    });

    it("cliente público sin secreto (la SPA no puede guardarlo; PKCE lo sustituye)", () => {
      expect(client().GenerateSecret).toBe(false);
    });

    it("solo flujos de autenticación SRP y refresh (sin usuario/contraseña en claro ni admin)", () => {
      expect(client().ExplicitAuthFlows.sort()).toEqual([
        "ALLOW_REFRESH_TOKEN_AUTH",
        "ALLOW_USER_SRP_AUTH",
      ]);
    });

    it("solo el proveedor de identidad de Cognito y sin enumeración de usuarios", () => {
      expect(client().SupportedIdentityProviders).toEqual(["COGNITO"]);
      expect(client().PreventUserExistenceErrors).toBe("ENABLED");
    });

    it("las URLs de retorno por defecto son https o localhost, sin comodines", () => {
      for (const name of ["CallbackUrls", "LogoutUrls"]) {
        for (const url of String(template.Parameters[name].Default).split(",")) {
          expect(url).not.toContain("*");
          const parsed = new URL(url);
          expect(parsed.protocol === "https:" || parsed.hostname === "localhost").toBe(true);
        }
      }
    });
  });

  describe("scopes", () => {
    const serverScopes = () =>
      new Set(
        (resource("UserPoolResourceServer").Properties.Scopes as { ScopeName: string }[]).map(
          (scope) =>
            `${resource("UserPoolResourceServer").Properties.Identifier}/${scope.ScopeName}`,
        ),
      );

    it("todo scope que exige una política existe en el servidor de recursos y en el cliente", () => {
      const needed = new Set(Object.values(ACTIONS).map((policy) => policy.scope));
      for (const scope of needed) {
        expect(serverScopes().has(scope)).toBe(true);
        expect(client().AllowedOAuthScopes).toContain(scope);
      }
    });

    it("el cliente solo puede pedir scopes definidos (más openid)", () => {
      for (const scope of client().AllowedOAuthScopes as string[]) {
        expect(scope === "openid" || serverScopes().has(scope)).toBe(true);
      }
    });
  });

  describe("JWT authorizer de API Gateway (CA-03.2)", () => {
    it("lee el token de la cabecera Authorization", () => {
      expect(authorizer().IdentitySource).toBe("$request.header.Authorization");
    });

    it("valida el emisor del User Pool y la audiencia del cliente de la SPA", () => {
      expect(authorizer().JwtConfiguration.issuer).toContain("${UserPool}");
      expect(authorizer().JwtConfiguration.issuer).toMatch(/^https:\/\/cognito-idp\./);
      expect(authorizer().JwtConfiguration.audience).toEqual(["UserPoolClient"]);
    });

    it("el emisor del authorizer coincide con COGNITO_ISSUER de las Lambdas (defensa en profundidad)", () => {
      expect(template.Globals.Function.Environment.Variables.COGNITO_ISSUER).toBe(
        authorizer().JwtConfiguration.issuer,
      );
      expect(template.Globals.Function.Environment.Variables.COGNITO_CLIENT_ID).toBe(
        "UserPoolClient",
      );
    });

    it("no hay authorizer por defecto: cada ruta protegida lo declara con sus scopes", () => {
      expect(resource("HttpApi").Properties.Auth.DefaultAuthorizer).toBeUndefined();
    });

    it("toda ruta protegida declara authorizer y al menos un scope (así un ID token no pasa)", () => {
      const protectedRoutes = allRoutes().filter((route) => route.auth !== undefined);
      expect(protectedRoutes.length).toBeGreaterThan(0);
      for (const route of protectedRoutes) {
        expect(route.auth!.Authorizer).toBe("CognitoJwt");
        expect(asList(route.auth!.AuthorizationScopes).length).toBeGreaterThan(0);
      }
    });

    it("los scopes de cada ruta protegida coinciden con los de la política del backend", () => {
      const byRoute: Record<string, string> = {
        "POST /v1/donations/{donationId}/simulate": ACTIONS["donation:simulate"].scope,
      };
      for (const route of allRoutes().filter((r) => r.auth !== undefined)) {
        const expected = byRoute[`${route.method} ${route.path}`];
        if (expected) expect(route.auth!.AuthorizationScopes).toEqual([expected]);
      }
    });

    it("toda ruta sin authorizer es un GET de la lista blanca pública", () => {
      const allowed = new Set([
        "GET /v1/projects",
        "GET /v1/projects/{projectId}",
        "GET /v1/projects/{projectId}/stats",
      ]);
      for (const route of allRoutes().filter((r) => r.auth === undefined)) {
        expect(allowed.has(`${route.method} ${route.path}`)).toBe(true);
      }
    });
  });
});
