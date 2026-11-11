import type { User } from "oidc-client-ts";
import type { ReactNode } from "react";
import { type AuthContextValue, type AuthManager } from "../src/auth/AuthProvider";
export declare const TOKEN = "SECRET-ACCESS-TOKEN-123";
export interface FakeUserOptions {
    access_token?: string;
    expired?: boolean;
    profile?: Record<string, unknown>;
    state?: unknown;
}
export declare function makeUser(options?: FakeUserOptions): User;
type Listener = (...args: never[]) => void;
/** Doble de `UserManager` que registra llamadas y permite disparar eventos. */
export declare function createFakeManager(initialUser?: User | null): {
    manager: AuthManager & {
        getUser: import("vitest").Mock<() => Promise<User | null>>;
        signinRedirect: import("vitest").Mock<() => Promise<undefined>>;
        signinRedirectCallback: import("vitest").Mock<() => Promise<User>>;
        signoutRedirect: import("vitest").Mock<() => Promise<undefined>>;
        removeUser: import("vitest").Mock<() => Promise<undefined>>;
        revokeTokens: import("vitest").Mock<() => Promise<undefined>>;
        events: {
            addUserLoaded: (callback: Listener) => void;
            removeUserLoaded: (callback: Listener) => void;
            addUserUnloaded: (callback: Listener) => void;
            removeUserUnloaded: (callback: Listener) => void;
            addAccessTokenExpired: (callback: Listener) => void;
            removeAccessTokenExpired: (callback: Listener) => void;
            addSilentRenewError: (callback: Listener) => void;
            removeSilentRenewError: (callback: Listener) => void;
        };
    };
    emit: (name: string, ...args: unknown[]) => void | undefined;
    listenerCount: (name: string) => number;
};
export declare function fakeAuth(overrides?: Partial<AuthContextValue>): AuthContextValue;
export declare function withAuth(value: AuthContextValue): ({ children }: {
    children: ReactNode;
}) => import("react").JSX.Element;
export {};
