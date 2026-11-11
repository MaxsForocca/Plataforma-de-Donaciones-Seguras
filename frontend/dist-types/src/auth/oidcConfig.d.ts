/**
 * Configuración OIDC (Authorization Code + PKCE contra Cognito).
 *
 * Constitución, principio V: los tokens viven solo en memoria (`userStore` en memoria; nunca
 * `localStorage` ni `sessionStorage`). El `stateStore` guarda únicamente el `state` y el
 * `code_verifier` de PKCE en `sessionStorage` para sobrevivir a la redirección al Hosted UI; no
 * contiene tokens. No se usa el flujo implícito (`response_type` es siempre `code`).
 */
import { UserManager, type UserManagerSettings } from "oidc-client-ts";
export interface OidcConfig {
    authority: string;
    clientId: string;
    redirectUri: string;
    logoutUri: string;
    /** Dominio del Hosted UI de Cognito, sin esquema. */
    cognitoDomain: string;
    scope: string;
}
export declare const DEFAULT_SCOPE = "openid api/donations.read api/donations.write api/projects.write";
export interface OidcEnv {
    VITE_OIDC_AUTHORITY?: string;
    VITE_OIDC_CLIENT_ID?: string;
    VITE_OIDC_REDIRECT_URI?: string;
    VITE_OIDC_LOGOUT_URI?: string;
    VITE_OIDC_COGNITO_DOMAIN?: string;
}
export type OidcConfigResult = {
    ok: true;
    config: OidcConfig;
} | {
    ok: false;
    invalid: readonly string[];
};
export declare function readOidcConfig(env: OidcEnv): OidcConfigResult;
export declare function buildUserManagerSettings(config: OidcConfig, stateStorage?: Storage): UserManagerSettings;
export declare function createUserManager(config: OidcConfig): UserManager;
