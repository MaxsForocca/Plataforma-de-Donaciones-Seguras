/**
 * T045 / T059 — Inicio y cierre de sesión con la biblioteca OIDC REAL (oidc-client-ts) y un Cognito
 * SIMULADO solo a nivel de `fetch`. Se verifica el comportamiento de la SPA: PKCE (S256), flujo de
 * código sin implícito, tokens solo en memoria, revocación del refresh token al cerrar sesión,
 * validación del ID token y manejo de un login incompleto (p. ej. sin segundo factor).
 *
 * NO se prueba contra Cognito real (ver evidence/auth-pending-deployment.md): la forma exacta de las
 * respuestas de Cognito y el desafío MFA del Hosted UI quedan pendientes de despliegue.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { createHash } from "node:crypto";
import { OidcClient, UserManager } from "oidc-client-ts";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../src/auth/AuthProvider";
import { buildUserManagerSettings, DEFAULT_SCOPE, type OidcConfig } from "../src/auth/oidcConfig";

const AUTHORITY = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TEST";
const DOMAIN = "donaciones-academic-1.auth.us-east-1.amazoncognito.com";
const CLIENT_ID = "client-123";
const REDIRECT = "https://app.example.com/callback";
const config: OidcConfig = {
  authority: AUTHORITY,
  clientId: CLIENT_ID,
  redirectUri: REDIRECT,
  logoutUri: "https://app.example.com/",
  cognitoDomain: DOMAIN,
  scope: DEFAULT_SCOPE,
};
const IDENTITY = { clientId: CLIENT_ID, issuer: AUTHORITY };

const SECRET_REFRESH = "REFRESH-TOKEN-SECRETO";
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (claims: Record<string, unknown>) =>
  `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.firma`;
const nowSeconds = () => Math.floor(Date.now() / 1000);

interface CognitoStub {
  fetchMock: ReturnType<typeof vi.fn>;
  tokenRequests: URLSearchParams[];
  revocations: URLSearchParams[];
  /** Permite alterar la respuesta del endpoint de tokens en cada prueba. */
  tokenResponse: (nonce: string | null) => Record<string, unknown>;
}

function stubCognito(): CognitoStub {
  const stub: CognitoStub = {
    fetchMock: vi.fn(),
    tokenRequests: [],
    revocations: [],
    tokenResponse: (nonce) => ({
      access_token: jwt({
        token_use: "access",
        client_id: CLIENT_ID,
        sub: "user-1",
        exp: nowSeconds() + 900,
      }),
      id_token: jwt({
        token_use: "id",
        iss: AUTHORITY,
        aud: CLIENT_ID,
        sub: "user-1",
        "cognito:groups": ["DONANTE"],
        iat: nowSeconds(),
        exp: nowSeconds() + 900,
        ...(nonce ? { nonce } : {}),
      }),
      refresh_token: SECRET_REFRESH,
      token_type: "Bearer",
      expires_in: 900,
      scope: DEFAULT_SCOPE,
    }),
  };
  let lastNonce: string | null = null;

  stub.fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (url.endsWith("/.well-known/openid-configuration")) {
      return json({
        issuer: AUTHORITY,
        authorization_endpoint: `https://${DOMAIN}/oauth2/authorize`,
        token_endpoint: `https://${DOMAIN}/oauth2/token`,
        userinfo_endpoint: `https://${DOMAIN}/oauth2/userInfo`,
        jwks_uri: `${AUTHORITY}/.well-known/jwks.json`,
      });
    }
    if (url === `https://${DOMAIN}/oauth2/token`) {
      stub.tokenRequests.push(new URLSearchParams(String(init?.body)));
      return json(stub.tokenResponse(lastNonce));
    }
    if (url === `https://${DOMAIN}/oauth2/revoke`) {
      stub.revocations.push(new URLSearchParams(String(init?.body)));
      return json({});
    }
    return json({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", stub.fetchMock);
  // El nonce (si la biblioteca lo envía) debe repetirse en el ID token.
  (stub as unknown as { setNonce: (n: string | null) => void }).setNonce = (n) => {
    lastNonce = n;
  };
  return stub;
}

/** Crea la petición de autorización con la configuración REAL y deja el `state` en el almacenamiento. */
async function startLogin(manager: UserManager, stub: CognitoStub, returnTo = "/me/donations") {
  const request = await new OidcClient(manager.settings).createSigninRequest({
    state: { returnTo },
  });
  const url = new URL(request.url);
  (stub as unknown as { setNonce: (n: string | null) => void }).setNonce(
    url.searchParams.get("nonce"),
  );
  return { url, stateId: url.searchParams.get("state")! };
}

const goToCallback = (query: string) => window.history.pushState({}, "", `/callback?${query}`);

function mount(manager: UserManager, identity: typeof IDENTITY | null = IDENTITY) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider
      manager={manager}
      identity={identity ?? undefined}
      logout={{ clientId: CLIENT_ID, logoutUri: config.logoutUri }}
    >
      {children}
    </AuthProvider>
  );
  return renderHook(() => useAuth(), { wrapper });
}

let stub: CognitoStub;
let manager: UserManager;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  stub = stubCognito();
  manager = new UserManager(buildUserManagerSettings(config));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

const storedText = () =>
  JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });

describe("PKCE y flujo de código (CA-03.1)", () => {
  it("la petición de autorización usa response_type=code con PKCE S256 y state", async () => {
    const { url } = await startLogin(manager, stub);
    expect(url.origin + url.pathname).toBe(`https://${DOMAIN}/oauth2/authorize`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("scope")).toContain("openid");
  });

  it("nunca pide tokens directamente (sin flujo implícito)", async () => {
    const { url } = await startLogin(manager, stub);
    expect(url.searchParams.get("response_type")).not.toMatch(/token/);
    expect(url.search).not.toMatch(/response_type=(id_)?token/);
  });

  it("el code_verifier no viaja en la URL de autorización", async () => {
    const { url } = await startLogin(manager, stub);
    expect(url.search).not.toContain("code_verifier");
  });

  it("cada intento genera un state y un code_challenge distintos", async () => {
    const a = await startLogin(manager, stub);
    const b = await startLogin(manager, stub);
    expect(a.url.searchParams.get("state")).not.toBe(b.url.searchParams.get("state"));
    expect(a.url.searchParams.get("code_challenge")).not.toBe(
      b.url.searchParams.get("code_challenge"),
    );
  });

  it("el code_verifier del intercambio de código corresponde al code_challenge enviado (S256)", async () => {
    const { url, stateId } = await startLogin(manager, stub);
    goToCallback(`code=codigo-1&state=${stateId}`);
    const { result } = mount(manager);
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
    await act(async () => void (await result.current.completeLogin()));

    expect(stub.tokenRequests).toHaveLength(1);
    const body = stub.tokenRequests[0]!;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("codigo-1");
    expect(body.get("client_id")).toBe(CLIENT_ID);
    expect(body.get("redirect_uri")).toBe(REDIRECT);
    const verifier = body.get("code_verifier")!;
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(url.searchParams.get("code_challenge"));
  });

  it("no envía client_secret (cliente público)", async () => {
    const { stateId } = await startLogin(manager, stub);
    goToCallback(`code=c&state=${stateId}`);
    const { result } = mount(manager);
    await act(async () => void (await result.current.completeLogin()));
    expect(stub.tokenRequests[0]!.has("client_secret")).toBe(false);
  });
});

describe("tokens solo en memoria (CA-03.3, principio V)", () => {
  async function login() {
    const { stateId } = await startLogin(manager, stub, "/me/donations");
    goToCallback(`code=codigo&state=${stateId}`);
    const hook = mount(manager);
    let returnTo: string | null = null;
    await act(async () => {
      returnTo = await hook.result.current.completeLogin();
    });
    return { ...hook, returnTo };
  }

  it("tras el login hay sesión en memoria y devuelve la ruta de retorno guardada", async () => {
    const { result, returnTo } = await login();
    expect(result.current.status).toBe("authenticated");
    expect(result.current.getAccessToken()).toBeTruthy();
    expect(returnTo).toBe("/me/donations");
    expect(result.current.groups).toEqual(["DONANTE"]);
  });

  it("ningún token (access, ID ni refresh) llega a localStorage ni a sessionStorage", async () => {
    await login();
    expect(localStorage.length).toBe(0);
    expect(storedText()).not.toContain(SECRET_REFRESH);
    expect(storedText()).not.toMatch(/access_token|refresh_token|id_token/);
    expect(storedText()).not.toContain("eyJ"); // ningún JWT
  });

  it("una recarga de la página (nuevo UserManager) no recupera la sesión", async () => {
    await login();
    const reloaded = new UserManager(buildUserManagerSettings(config));
    expect(await reloaded.getUser()).toBeNull();
    const { result } = mount(reloaded);
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
    expect(result.current.getAccessToken()).toBeNull();
  });

  it("el estado de PKCE se consume: no queda state ni verifier en el almacenamiento", async () => {
    await login();
    expect(sessionStorage.length).toBe(0);
  });
});

describe("cierre de sesión: revoca el refresh token y limpia la memoria", () => {
  it("envía la revocación del refresh token al endpoint de Cognito y elimina al usuario", async () => {
    const { stateId } = await startLogin(manager, stub);
    goToCallback(`code=c&state=${stateId}`);
    const { result } = mount(manager);
    await act(async () => void (await result.current.completeLogin()));
    expect(result.current.status).toBe("authenticated");
    vi.spyOn(manager, "signoutRedirect").mockResolvedValue(undefined);

    await act(() => result.current.logout());

    expect(stub.revocations).toHaveLength(1);
    const body = stub.revocations[0]!;
    expect(body.get("token")).toBe(SECRET_REFRESH);
    expect(body.get("token_type_hint")).toBe("refresh_token");
    expect(body.get("client_id")).toBe(CLIENT_ID);
    expect(await manager.getUser()).toBeNull();
    expect(result.current.getAccessToken()).toBeNull();
    expect(result.current.status).toBe("unauthenticated");
    expect(storedText()).not.toContain(SECRET_REFRESH);
  });

  it("si Cognito rechaza la revocación, igualmente se borran los tokens y se avisa al usuario", async () => {
    const { stateId } = await startLogin(manager, stub);
    goToCallback(`code=c&state=${stateId}`);
    const { result } = mount(manager);
    await act(async () => void (await result.current.completeLogin()));
    vi.spyOn(manager, "signoutRedirect").mockResolvedValue(undefined);
    const original = stub.fetchMock.getMockImplementation() as (
      i: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response>;
    stub.fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/oauth2/revoke")) return new Response("{}", { status: 400 });
      return original(input, init);
    });

    await act(() => result.current.logout());

    expect(result.current.getAccessToken()).toBeNull();
    expect(result.current.error).toMatch(/no se pudo revocar/i);
  });
});

describe("callback inválido o manipulado", () => {
  it("un state que no coincide con el guardado se rechaza (CSRF) sin pedir tokens", async () => {
    await startLogin(manager, stub);
    goToCallback("code=c&state=state-inventado");
    const { result } = mount(manager);
    let returnTo: string | null = "x";
    await act(async () => {
      returnTo = await result.current.completeLogin();
    });
    expect(returnTo).toBeNull();
    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.getAccessToken()).toBeNull();
    expect(stub.tokenRequests).toHaveLength(0);
  });

  it("sin state se rechaza", async () => {
    await startLogin(manager, stub);
    goToCallback("code=c");
    const { result } = mount(manager);
    await act(async () => void (await result.current.completeLogin()));
    expect(result.current.status).toBe("unauthenticated");
    expect(stub.tokenRequests).toHaveLength(0);
  });

  it("el callback no se puede reutilizar (el state es de un solo uso)", async () => {
    const { stateId } = await startLogin(manager, stub);
    goToCallback(`code=c&state=${stateId}`);
    const first = mount(manager);
    await act(async () => void (await first.result.current.completeLogin()));
    expect(first.result.current.status).toBe("authenticated");

    const replayManager = new UserManager(buildUserManagerSettings(config));
    const second = mount(replayManager);
    await act(async () => void (await second.result.current.completeLogin()));
    expect(second.result.current.status).toBe("unauthenticated");
    expect(stub.tokenRequests).toHaveLength(1);
  });

  it("si el endpoint de tokens falla, no hay sesión ni detalles técnicos visibles", async () => {
    const { stateId } = await startLogin(manager, stub);
    goToCallback(`code=c&state=${stateId}`);
    const original = stub.fetchMock.getMockImplementation() as (
      i: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response>;
    stub.fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/oauth2/token")) {
        return new Response(
          JSON.stringify({ error: "invalid_grant", error_description: "detalle interno" }),
          { status: 400 },
        );
      }
      return original(input, init);
    });
    const { result } = mount(manager);
    await act(async () => void (await result.current.completeLogin()));
    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.error).not.toMatch(/invalid_grant|detalle interno/);
  });
});

describe("validación del ID token en la SPA (defensa en profundidad)", () => {
  async function attempt(override: (nonce: string | null) => Record<string, unknown>) {
    stub.tokenResponse = override;
    const { stateId } = await startLogin(manager, stub);
    goToCallback(`code=c&state=${stateId}`);
    const hook = mount(manager);
    let returnTo: string | null = "x";
    await act(async () => {
      returnTo = await hook.result.current.completeLogin();
    });
    return { ...hook, returnTo };
  }
  const validId = (nonce: string | null, extra: Record<string, unknown> = {}) =>
    jwt({
      token_use: "id",
      iss: AUTHORITY,
      aud: CLIENT_ID,
      sub: "user-1",
      iat: nowSeconds(),
      exp: nowSeconds() + 900,
      ...(nonce ? { nonce } : {}),
      ...extra,
    });
  const tokens = (
    id_token: string,
    access_token = jwt({ token_use: "access", sub: "user-1" }),
  ) => ({
    access_token,
    id_token,
    refresh_token: SECRET_REFRESH,
    token_type: "Bearer",
    expires_in: 900,
  });

  it.each([
    ["emitido para otro cliente (aud)", { aud: "otro-cliente" }],
    ["aud como arreglo sin este cliente", { aud: ["otro-1", "otro-2"] }],
    ["de otro emisor (iss)", { iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_OTRO" }],
    ["vencido", { exp: nowSeconds() - 10 }],
    ["sin exp", { exp: undefined }],
    ["marcado como access token (token_use)", { token_use: "access" }],
  ])("rechaza un ID token %s", async (_label, claims) => {
    const { result, returnTo } = await attempt((nonce) => tokens(validId(nonce, claims)));
    expect(returnTo).toBeNull();
    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.getAccessToken()).toBeNull();
    expect(result.current.error).toMatch(/No se pudo completar/);
    expect(await manager.getUser()).toBeNull(); // no queda nada en memoria
  });

  it("rechaza si el access token es idéntico al ID token (token confundido)", async () => {
    const { result, returnTo } = await attempt((nonce) => {
      const id = validId(nonce);
      return tokens(id, id);
    });
    expect(returnTo).toBeNull();
    expect(result.current.status).toBe("unauthenticated");
  });

  it("acepta un ID token válido (aud como arreglo que incluye este cliente)", async () => {
    const { result, returnTo } = await attempt((nonce) =>
      tokens(validId(nonce, { aud: ["otro", CLIENT_ID] })),
    );
    expect(returnTo).toBe("/me/donations");
    expect(result.current.status).toBe("authenticated");
  });

  it("sin la validación de identidad configurada no se aplica (solo pruebas); main.tsx siempre la pasa", async () => {
    stub.tokenResponse = (nonce) => tokens(validId(nonce, { aud: "otro-cliente" }));
    const { stateId } = await startLogin(manager, stub);
    goToCallback(`code=c&state=${stateId}`);
    const { result } = mount(manager, null);
    await act(async () => void (await result.current.completeLogin()));
    expect(result.current.status).toBe("authenticated");
  });
});

describe("T059: login incompleto (p. ej. sin completar el segundo factor)", () => {
  async function callbackWithError(query: string) {
    await startLogin(manager, stub);
    const { stateId } = await startLogin(manager, stub);
    goToCallback(`${query}&state=${stateId}`);
    const hook = mount(manager);
    let returnTo: string | null = "x";
    await act(async () => {
      returnTo = await hook.result.current.completeLogin();
    });
    return { ...hook, returnTo };
  }

  it("access_denied (el usuario no completó la verificación) no deja sesión y orienta sobre el segundo factor", async () => {
    const { result, returnTo } = await callbackWithError("error=access_denied");
    expect(returnTo).toBeNull();
    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.getAccessToken()).toBeNull();
    expect(result.current.error).toMatch(/segundo factor/i);
    expect(stub.tokenRequests).toHaveLength(0);
  });

  it("no muestra la descripción del error que viene en la URL (podría contener texto del atacante)", async () => {
    const { result } = await callbackWithError(
      `error=access_denied&error_description=${encodeURIComponent("<script>alert(1)</script> usuario no verificado")}`,
    );
    expect(result.current.error).not.toMatch(/script|alert|usuario no verificado/);
  });

  it.each(["server_error", "invalid_request", "unauthorized_client", "temporarily_unavailable"])(
    "%s → mensaje genérico, sin sesión",
    async (error) => {
      const { result } = await callbackWithError(`error=${error}`);
      expect(result.current.status).toBe("unauthenticated");
      expect(result.current.error).toMatch(/No se pudo completar el inicio de sesión/);
      expect(result.current.error).not.toContain(error);
    },
  );

  it("un código de error desconocido o vacío también es genérico", async () => {
    const { result } = await callbackWithError("error=%3Cb%3Ex");
    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.error).not.toMatch(/<b>/);
  });

  it("Cognito responde sin ID token en el intercambio: no se inicia sesión", async () => {
    stub.tokenResponse = () => ({
      access_token: jwt({ token_use: "access", sub: "u" }),
      refresh_token: SECRET_REFRESH,
      token_type: "Bearer",
      expires_in: 900,
    });
    const { stateId } = await startLogin(manager, stub);
    goToCallback(`code=c&state=${stateId}`);
    const { result } = mount(manager);
    await act(async () => void (await result.current.completeLogin()));
    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.getAccessToken()).toBeNull();
  });
});
