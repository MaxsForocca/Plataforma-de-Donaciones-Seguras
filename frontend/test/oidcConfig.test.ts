import { afterEach, describe, expect, it } from "vitest";
import {
  buildUserManagerSettings,
  createUserManager,
  DEFAULT_SCOPE,
  readOidcConfig,
  type OidcConfig,
  type OidcEnv,
} from "../src/auth/oidcConfig";

const ENV: OidcEnv = {
  VITE_OIDC_AUTHORITY: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TEST",
  VITE_OIDC_CLIENT_ID: "client-123",
  VITE_OIDC_REDIRECT_URI: "https://app.example.com/callback",
  VITE_OIDC_LOGOUT_URI: "https://app.example.com/",
  VITE_OIDC_COGNITO_DOMAIN: "donaciones-academic-1.auth.us-east-1.amazoncognito.com",
};

function config(env: OidcEnv = ENV): OidcConfig {
  const result = readOidcConfig(env);
  if (!result.ok) throw new Error(`env inválido: ${result.invalid.join(",")}`);
  return result.config;
}

function invalid(env: OidcEnv): readonly string[] {
  const result = readOidcConfig(env);
  if (result.ok) throw new Error("Se esperaba configuración inválida");
  return result.invalid;
}

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("readOidcConfig", () => {
  it("acepta un entorno completo y fija los scopes de la API", () => {
    expect(config()).toMatchObject({
      authority: ENV.VITE_OIDC_AUTHORITY,
      clientId: "client-123",
      scope: DEFAULT_SCOPE,
    });
    expect(DEFAULT_SCOPE.split(" ")).toEqual(
      expect.arrayContaining(["openid", "api/donations.read", "api/donations.write"]),
    );
  });

  it.each(Object.keys(ENV) as (keyof OidcEnv)[])("informa %s cuando falta", (key) => {
    expect(invalid({ ...ENV, [key]: undefined })).toEqual([key]);
    expect(invalid({ ...ENV, [key]: "" })).toEqual([key]);
  });

  it("informa todas las variables faltantes juntas, sin mostrar valores", () => {
    expect(invalid({})).toHaveLength(5);
  });

  it("acepta http solo para localhost (desarrollo)", () => {
    expect(
      readOidcConfig({
        ...ENV,
        VITE_OIDC_REDIRECT_URI: "http://localhost:5173/callback",
        VITE_OIDC_LOGOUT_URI: "http://localhost:5173/",
      }).ok,
    ).toBe(true);
  });

  it.each([
    ["authority http no local", { VITE_OIDC_AUTHORITY: "http://idp.example.com" }],
    ["redirect http no local", { VITE_OIDC_REDIRECT_URI: "http://app.example.com/callback" }],
    ["logout http no local", { VITE_OIDC_LOGOUT_URI: "http://app.example.com/" }],
    ["authority sin esquema", { VITE_OIDC_AUTHORITY: "idp.example.com" }],
    ["authority javascript:", { VITE_OIDC_AUTHORITY: "javascript:alert(1)" }],
    ["dominio con esquema", { VITE_OIDC_COGNITO_DOMAIN: "https://x.auth.example.com" }],
    ["dominio sin punto", { VITE_OIDC_COGNITO_DOMAIN: "localhost" }],
    ["dominio con ruta", { VITE_OIDC_COGNITO_DOMAIN: "x.auth.example.com/logout" }],
    ["dominio con espacios", { VITE_OIDC_COGNITO_DOMAIN: "x .example.com" }],
  ])("rechaza %s", (_label, override) => {
    expect(invalid({ ...ENV, ...override })).toHaveLength(1);
  });
});

describe("buildUserManagerSettings (principio V)", () => {
  it("usa Authorization Code (nunca el flujo implícito)", () => {
    const settings = buildUserManagerSettings(config());
    expect(settings.response_type).toBe("code");
    expect(settings.response_type).not.toMatch(/token/);
  });

  it("apunta a Cognito con el cliente y las URIs configuradas", () => {
    expect(buildUserManagerSettings(config())).toMatchObject({
      authority: ENV.VITE_OIDC_AUTHORITY,
      client_id: "client-123",
      redirect_uri: ENV.VITE_OIDC_REDIRECT_URI,
      post_logout_redirect_uri: ENV.VITE_OIDC_LOGOUT_URI,
      scope: DEFAULT_SCOPE,
      loadUserInfo: false,
      automaticSilentRenew: true,
    });
  });

  it("declara los endpoints de logout y revocación que Cognito no publica", () => {
    expect(buildUserManagerSettings(config()).metadataSeed).toEqual({
      end_session_endpoint: `https://${ENV.VITE_OIDC_COGNITO_DOMAIN}/logout`,
      revocation_endpoint: `https://${ENV.VITE_OIDC_COGNITO_DOMAIN}/oauth2/revoke`,
    });
  });

  it("los tokens (userStore) nunca llegan a localStorage ni a sessionStorage", async () => {
    const settings = buildUserManagerSettings(config());
    await settings.userStore!.set("user", '{"access_token":"SECRET","refresh_token":"SECRET2"}');

    expect(await settings.userStore!.get("user")).toContain("SECRET");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("el userStore en memoria se pierde con otro manager (no persiste entre cargas)", async () => {
    const first = buildUserManagerSettings(config());
    await first.userStore!.set("user", "SECRET");
    const second = buildUserManagerSettings(config());
    expect(await second.userStore!.get("user")).toBeFalsy();
  });

  it("el estado de PKCE se guarda en sessionStorage y no en localStorage", async () => {
    const settings = buildUserManagerSettings(config());
    await settings.stateStore!.set("state-1", '{"code_verifier":"abc"}');
    expect(sessionStorage.length).toBe(1);
    expect(localStorage.length).toBe(0);
    expect(JSON.stringify({ ...sessionStorage })).not.toMatch(/access_token|refresh_token/);
  });

  it("el almacenamiento del estado es inyectable", async () => {
    const calls: string[] = [];
    const fake = {
      length: 0,
      key: () => null,
      clear: () => {},
      getItem: () => null,
      removeItem: () => {},
      setItem: (key: string) => void calls.push(key),
    } as unknown as Storage;
    const settings = buildUserManagerSettings(config(), fake);
    await settings.stateStore!.set("s", "v");
    expect(calls).toHaveLength(1);
    expect(sessionStorage.length).toBe(0);
  });

  it("createUserManager construye un UserManager sin tocar el almacenamiento web", () => {
    const manager = createUserManager(config());
    expect(manager.settings.response_type).toBe("code");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
