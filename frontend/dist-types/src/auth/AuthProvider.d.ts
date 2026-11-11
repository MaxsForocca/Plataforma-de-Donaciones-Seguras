/**
 * Proveedor de autenticación OIDC (T031). Authorization Code + PKCE, access token solo en memoria y
 * revocación del refresh token al cerrar sesión. Los grupos que expone son solo para UX: la
 * autorización real la decide siempre el backend.
 */
import type { User } from "oidc-client-ts";
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
    /** Completa el callback del Hosted UI y devuelve la ruta interna a la que volver. */
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
export interface AuthProviderProps {
    manager: AuthManager;
    /** Parámetros de cierre de sesión de Cognito (`client_id` y `logout_uri`). */
    logout?: {
        clientId: string;
        logoutUri: string;
    };
    children: ReactNode;
}
export declare function AuthProvider({ manager, logout: logoutParams, children }: AuthProviderProps): import("react").JSX.Element;
