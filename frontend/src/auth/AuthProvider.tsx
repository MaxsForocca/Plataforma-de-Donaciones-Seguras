/**
 * Proveedor de autenticación OIDC (T031). Authorization Code + PKCE, access token solo en memoria y
 * revocación del refresh token al cerrar sesión. Los grupos que expone son solo para UX: la
 * autorización real la decide siempre el backend.
 */
import type { User } from "oidc-client-ts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
  signinRedirect(args?: { state?: unknown }): Promise<void>;
  signinRedirectCallback(): Promise<User>;
  signoutRedirect(args?: { extraQueryParams?: Record<string, string> }): Promise<void>;
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

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return value;
}

/** Evita redirecciones abiertas: solo rutas internas absolutas y distintas del callback. */
export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!/^\/(?![/\\])/.test(value) || /[\\\r\n\0]/.test(value)) return "/";
  if (value === "/callback" || value.startsWith("/callback?")) return "/";
  return value;
}

function isUsable(user: User | null | undefined): user is User {
  return !!user && !!user.access_token && !user.expired;
}

function groupsOf(user: User | null): readonly string[] {
  const raw = (user?.profile as Record<string, unknown> | undefined)?.["cognito:groups"];
  return Array.isArray(raw)
    ? raw.filter((group): group is string => typeof group === "string")
    : [];
}

export interface AuthProviderProps {
  manager: AuthManager;
  /** Parámetros de cierre de sesión de Cognito (`client_id` y `logout_uri`). */
  logout?: { clientId: string; logoutUri: string };
  children: ReactNode;
}

export function AuthProvider({ manager, logout: logoutParams, children }: AuthProviderProps) {
  // El usuario (con sus tokens) vive solo en una referencia en memoria; nunca en Web Storage.
  const userRef = useRef<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [groups, setGroups] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((user: User | null) => {
    const usable = isUsable(user) ? user : null;
    userRef.current = usable;
    setGroups(groupsOf(usable));
    setStatus(usable ? "authenticated" : "unauthenticated");
  }, []);

  useEffect(() => {
    let active = true;
    const onLoaded = (user: User) => active && apply(user);
    const onGone = () => active && apply(null);
    const onRenewError = () => {
      if (active) setError("La sesión no pudo renovarse. Inicie sesión nuevamente.");
    };

    manager.events.addUserLoaded(onLoaded);
    manager.events.addUserUnloaded(onGone);
    manager.events.addAccessTokenExpired(onGone);
    manager.events.addSilentRenewError(onRenewError);

    manager
      .getUser()
      .then((user) => active && apply(user))
      .catch(() => active && apply(null));

    return () => {
      active = false;
      manager.events.removeUserLoaded(onLoaded);
      manager.events.removeUserUnloaded(onGone);
      manager.events.removeAccessTokenExpired(onGone);
      manager.events.removeSilentRenewError(onRenewError);
    };
  }, [manager, apply]);

  const getAccessToken = useCallback((): string | null => {
    const user = userRef.current;
    if (!isUsable(user)) return null;
    return user.access_token;
  }, []);

  const login = useCallback(
    async (returnTo?: string) => {
      setError(null);
      try {
        await manager.signinRedirect({ state: { returnTo: sanitizeReturnTo(returnTo) } });
      } catch {
        setError("No se pudo iniciar el inicio de sesión. Inténtelo nuevamente.");
      }
    },
    [manager],
  );

  const completeLogin = useCallback(async (): Promise<string | null> => {
    setError(null);
    try {
      const user = await manager.signinRedirectCallback();
      apply(user);
      return sanitizeReturnTo((user.state as { returnTo?: unknown } | undefined)?.returnTo);
    } catch {
      apply(null);
      setError("No se pudo completar el inicio de sesión. Inténtelo nuevamente.");
      return null;
    }
  }, [manager, apply]);

  const logout = useCallback(async () => {
    setError(null);
    let revoked = true;
    try {
      // Constitución, principio V: el refresh token debe revocarse al cerrar sesión.
      await manager.revokeTokens(["refresh_token"]);
    } catch {
      revoked = false;
    }

    // Los tokens se eliminan de memoria aunque la revocación falle.
    apply(null);
    try {
      await manager.removeUser();
    } catch {
      // el estado en memoria ya se limpió
    }
    if (!revoked) {
      setError("La sesión se cerró en este navegador, pero no se pudo revocar en el servidor.");
    }

    try {
      await manager.signoutRedirect(
        logoutParams
          ? {
              extraQueryParams: {
                client_id: logoutParams.clientId,
                logout_uri: logoutParams.logoutUri,
              },
            }
          : undefined,
      );
    } catch {
      // sin redirección de cierre: la sesión local ya está limpia
    }
  }, [manager, apply, logoutParams]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, groups, error, getAccessToken, login, completeLogin, logout }),
    [status, groups, error, getAccessToken, login, completeLogin, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
