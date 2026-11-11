/**
 * Proveedor de autenticación OIDC (T031, T047, T059). Authorization Code + PKCE, access token solo en
 * memoria, revocación del refresh token al cerrar sesión y validación del ID token (emisor,
 * audiencia, expiración y `token_use`) porque la biblioteca no la hace en el flujo de código. Los
 * grupos que expone son solo para UX: la autorización real la decide siempre el backend.
 *
 * El desafío de segundo factor (MFA) ocurre dentro del Hosted UI de Cognito; la SPA solo recibe el
 * resultado. Si el usuario no lo completa, el callback llega con un error y NO se inicia sesión.
 */
import { ErrorResponse, type User } from "oidc-client-ts";
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
  /** Completa el callback del Hosted UI y devuelve la ruta interna a la que volver (`null` si falla). */
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

export const LOGIN_FAILED_MESSAGE =
  "No se pudo completar el inicio de sesión. Inténtelo nuevamente.";
export const LOGIN_INCOMPLETE_MESSAGE =
  "No se completó la verificación de identidad (segundo factor). Inicie sesión nuevamente.";

/** Identidad esperada del ID token: el cliente de la SPA y el emisor del User Pool. */
export interface ExpectedIdentity {
  clientId: string;
  issuer: string;
}

function isUsable(user: User | null | undefined): user is User {
  return !!user && !!user.access_token && !user.expired;
}

/**
 * Valida el ID token (oidc-client-ts no verifica `iss`, `aud` ni `exp` en el flujo de código):
 * emisor y audiencia propios, no vencido, `token_use=id`, y que no se haya devuelto el mismo token
 * como access token.
 */
function isTrusted(user: User, expected: ExpectedIdentity | undefined): boolean {
  if (!expected) return true;
  const profile = user.profile as Record<string, unknown> | undefined;
  if (!profile) return false;

  const audience = Array.isArray(profile.aud) ? profile.aud : [profile.aud];
  if (profile.iss !== expected.issuer || !audience.includes(expected.clientId)) return false;
  if (typeof profile.exp !== "number" || profile.exp * 1000 <= Date.now()) return false;
  if (profile.token_use !== "id") return false;
  if (user.id_token && user.id_token === user.access_token) return false;
  return true;
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
  /** Si se indica, el ID token debe pertenecer a este cliente y emisor (main.tsx siempre lo pasa). */
  identity?: ExpectedIdentity;
  children: ReactNode;
}

export function AuthProvider({
  manager,
  logout: logoutParams,
  identity,
  children,
}: AuthProviderProps) {
  // El usuario (con sus tokens) vive solo en una referencia en memoria; nunca en Web Storage.
  const userRef = useRef<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [groups, setGroups] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(
    (user: User | null) => {
      const usable = isUsable(user) && isTrusted(user, identity) ? user : null;
      userRef.current = usable;
      setGroups(groupsOf(usable));
      setStatus(usable ? "authenticated" : "unauthenticated");
    },
    [identity],
  );

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
    const reject = async (message: string): Promise<null> => {
      // Nada de lo recibido debe quedar en memoria si se rechaza.
      try {
        await manager.removeUser();
      } catch {
        // sin usuario que eliminar
      }
      apply(null);
      setError(message);
      return null;
    };

    try {
      const user = await manager.signinRedirectCallback();
      if (!isUsable(user) || !isTrusted(user, identity)) return await reject(LOGIN_FAILED_MESSAGE);
      apply(user);
      return sanitizeReturnTo((user.state as { returnTo?: unknown } | undefined)?.returnTo);
    } catch (caught) {
      // access_denied: el usuario no completó la verificación (p. ej. el segundo factor).
      // La descripción del error viene de la URL y no se muestra nunca.
      const incomplete = caught instanceof ErrorResponse && caught.error === "access_denied";
      return await reject(incomplete ? LOGIN_INCOMPLETE_MESSAGE : LOGIN_FAILED_MESSAGE);
    }
  }, [manager, apply, identity]);

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
