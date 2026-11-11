/**
 * Proveedor de autenticación OIDC (T031, T047, T059). Authorization Code + PKCE, access token solo en
 * memoria, revocación del refresh token al cerrar sesión y validación del ID token (emisor,
 * audiencia, expiración y `token_use`) porque la biblioteca no la hace en el flujo de código. Los
 * grupos que expone son solo para UX: la autorización real la decide siempre el backend.
 *
 * El desafío de segundo factor (MFA) ocurre dentro del Hosted UI de Cognito; la SPA solo recibe el
 * resultado. Si el usuario no lo completa, el callback llega con un error y NO se inicia sesión.
 */
import { type User } from "oidc-client-ts";
import { type ReactNode } from "react";
export type AuthStatus = "loading" | "authenticated" | "unauthenticated";
export interface AuthContextValue {
    status: AuthStatus;
    /** Grupos del ID token, solo para mostrar u ocultar elementos de UI. */
    groups: readonly string[];
    /** Mensaje seguro para el usuario, o `null`. */
    error: string | null;
    /** Access token vigente (solo en memoria) o `null`. */
    getAccessToken: () => string | null;
    login: (returnTo?: string) => Promise<void>;
    /** Completa el callback del Hosted UI y devuelve la ruta interna a la que volver (`null` si falla). */
    completeLogin: () => Promise<string | null>;
    logout: () => Promise<void>;
}
/** Subconjunto de `UserManager` que usa el proveedor (permite dobles de prueba). */
export interface AuthManager {
    getUser(): Promise<User | null>;
    signinRedirect(args?: {
        state?: unknown;
    }): Promise<void>;
    signinRedirectCallback(): Promise<User>;
    signoutRedirect(args?: {
        extraQueryParams?: Record<string, string>;
    }): Promise<void>;
    removeUser(): Promise<void>;
    revokeTokens(types?: ("access_token" | "refresh_token")[]): Promise<void>;
    events: {
        addUserLoaded(callback: (user: User) => void): void;
        removeUserLoaded(callback: (user: User) => void): void;
        addUserUnloaded(callback: () => void): void;
        removeUserUnloaded(callback: () => void): void;
        addAccessTokenExpired(callback: () => void): void;
        removeAccessTokenExpired(callback: () => void): void;
        addSilentRenewError(callback: (error: Error) => void): void;
        removeSilentRenewError(callback: (error: Error) => void): void;
    };
}
export declare const AuthContext: import("react").Context<AuthContextValue | null>;
export declare function useAuth(): AuthContextValue;
/** Evita redirecciones abiertas: solo rutas internas absolutas y distintas del callback. */
export declare function sanitizeReturnTo(value: unknown): string;
export declare const LOGIN_FAILED_MESSAGE = "No se pudo completar el inicio de sesi\u00F3n. Int\u00E9ntelo nuevamente.";
export declare const LOGIN_INCOMPLETE_MESSAGE = "No se complet\u00F3 la verificaci\u00F3n de identidad (segundo factor). Inicie sesi\u00F3n nuevamente.";
/** Identidad esperada del ID token: el cliente de la SPA y el emisor del User Pool. */
export interface ExpectedIdentity {
    clientId: string;
    issuer: string;
}
export interface AuthProviderProps {
    manager: AuthManager;
    /** Parámetros de cierre de sesión de Cognito (`client_id` y `logout_uri`). */
    logout?: {
        clientId: string;
        logoutUri: string;
    };
    /** Si se indica, el ID token debe pertenecer a este cliente y emisor (main.tsx siempre lo pasa). */
    identity?: ExpectedIdentity;
    children: ReactNode;
}
export declare function AuthProvider({ manager, logout: logoutParams, identity, children, }: AuthProviderProps): import("react").JSX.Element;
