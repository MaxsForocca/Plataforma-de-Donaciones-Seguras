/**
 * Configuración OIDC (Authorization Code + PKCE contra Cognito).
 *
 * Constitución, principio V: los tokens viven solo en memoria (`userStore` en memoria; nunca
 * `localStorage` ni `sessionStorage`). El `stateStore` guarda únicamente el `state` y el
 * `code_verifier` de PKCE en `sessionStorage` para sobrevivir a la redirección al Hosted UI; no
 * contiene tokens. No se usa el flujo implícito (`response_type` es siempre `code`).
 */
import {
  InMemoryWebStorage,
  UserManager,
  WebStorageStateStore,
  type UserManagerSettings,
} from "oidc-client-ts";

export interface OidcConfig {
  authority: string;
  clientId: string;
  redirectUri: string;
  logoutUri: string;
  /** Dominio del Hosted UI de Cognito, sin esquema. */
  cognitoDomain: string;
  scope: string;
}

export const DEFAULT_SCOPE = "openid api/donations.read api/donations.write api/projects.write";

export interface OidcEnv {
  VITE_OIDC_AUTHORITY?: string;
  VITE_OIDC_CLIENT_ID?: string;
  VITE_OIDC_REDIRECT_URI?: string;
  VITE_OIDC_LOGOUT_URI?: string;
  VITE_OIDC_COGNITO_DOMAIN?: string;
}

export type OidcConfigResult =
  { ok: true; config: OidcConfig } | { ok: false; invalid: readonly string[] };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https siempre; http solo para localhost (desarrollo). */
function isSecureUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
  } catch {
    return false;
  }
}

const isDomain = (value: string | undefined): value is string =>
  !!value && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(value) && value.includes(".");

export function readOidcConfig(env: OidcEnv): OidcConfigResult {
  const invalid: string[] = [];
  if (!isSecureUrl(env.VITE_OIDC_AUTHORITY)) invalid.push("VITE_OIDC_AUTHORITY");
  if (!env.VITE_OIDC_CLIENT_ID) invalid.push("VITE_OIDC_CLIENT_ID");
  if (!isSecureUrl(env.VITE_OIDC_REDIRECT_URI)) invalid.push("VITE_OIDC_REDIRECT_URI");
  if (!isSecureUrl(env.VITE_OIDC_LOGOUT_URI)) invalid.push("VITE_OIDC_LOGOUT_URI");
  if (!isDomain(env.VITE_OIDC_COGNITO_DOMAIN)) invalid.push("VITE_OIDC_COGNITO_DOMAIN");
  if (invalid.length > 0) return { ok: false, invalid };

  return {
    ok: true,
    config: {
      authority: env.VITE_OIDC_AUTHORITY!,
      clientId: env.VITE_OIDC_CLIENT_ID!,
      redirectUri: env.VITE_OIDC_REDIRECT_URI!,
      logoutUri: env.VITE_OIDC_LOGOUT_URI!,
      cognitoDomain: env.VITE_OIDC_COGNITO_DOMAIN!,
      scope: DEFAULT_SCOPE,
    },
  };
}

export function buildUserManagerSettings(
  config: OidcConfig,
  stateStorage: Storage = window.sessionStorage,
): UserManagerSettings {
  return {
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    post_logout_redirect_uri: config.logoutUri,
    response_type: "code", // Authorization Code + PKCE (S256); nunca implícito
    scope: config.scope,
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    stateStore: new WebStorageStateStore({ store: stateStorage }),
    automaticSilentRenew: true,
    loadUserInfo: false,
    // Cognito no publica estos endpoints en su documento de descubrimiento.
    metadataSeed: {
      end_session_endpoint: `https://${config.cognitoDomain}/logout`,
      revocation_endpoint: `https://${config.cognitoDomain}/oauth2/revoke`,
    },
  };
}

export function createUserManager(config: OidcConfig): UserManager {
  return new UserManager(buildUserManagerSettings(config));
}
