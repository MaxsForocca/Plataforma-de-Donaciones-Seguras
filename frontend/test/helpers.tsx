import type { User } from "oidc-client-ts";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { AuthContext, type AuthContextValue, type AuthManager } from "../src/auth/AuthProvider";

export const TOKEN = "SECRET-ACCESS-TOKEN-123";

export interface FakeUserOptions {
  access_token?: string;
  expired?: boolean;
  profile?: Record<string, unknown>;
  state?: unknown;
}

export function makeUser(options: FakeUserOptions = {}): User {
  return {
    access_token: options.access_token ?? TOKEN,
    refresh_token: "SECRET-REFRESH-TOKEN-456",
    expired: options.expired ?? false,
    profile: { sub: "user-1", "cognito:groups": ["DONANTE"], ...options.profile },
    state: options.state,
  } as unknown as User;
}

type Listener = (...args: never[]) => void;

/** Doble de `UserManager` que registra llamadas y permite disparar eventos. */
export function createFakeManager(initialUser: User | null = null) {
  const listeners = new Map<string, Set<Listener>>();
  const add = (name: string) => (callback: Listener) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)!.add(callback);
  };
  const remove = (name: string) => (callback: Listener) => {
    listeners.get(name)?.delete(callback);
  };

  const manager = {
    getUser: vi.fn(async () => initialUser),
    signinRedirect: vi.fn(async () => undefined),
    signinRedirectCallback: vi.fn(async () => makeUser()),
    signoutRedirect: vi.fn(async () => undefined),
    removeUser: vi.fn(async () => undefined),
    revokeTokens: vi.fn(async () => undefined),
    events: {
      addUserLoaded: add("userLoaded"),
      removeUserLoaded: remove("userLoaded"),
      addUserUnloaded: add("userUnloaded"),
      removeUserUnloaded: remove("userUnloaded"),
      addAccessTokenExpired: add("accessTokenExpired"),
      removeAccessTokenExpired: remove("accessTokenExpired"),
      addSilentRenewError: add("silentRenewError"),
      removeSilentRenewError: remove("silentRenewError"),
    },
  };

  return {
    manager: manager as unknown as AuthManager & typeof manager,
    emit: (name: string, ...args: unknown[]) =>
      listeners.get(name)?.forEach((listener) => (listener as (...a: unknown[]) => void)(...args)),
    listenerCount: (name: string) => listeners.get(name)?.size ?? 0,
  };
}

export function fakeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: "unauthenticated",
    groups: [],
    error: null,
    getAccessToken: () => null,
    login: vi.fn(async () => undefined),
    completeLogin: vi.fn(async () => "/"),
    logout: vi.fn(async () => undefined),
    ...overrides,
  };
}

export function withAuth(value: AuthContextValue) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
  };
}
