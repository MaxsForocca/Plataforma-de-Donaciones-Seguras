import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, sanitizeReturnTo, useAuth } from "../src/auth/AuthProvider";
import { createFakeManager, makeUser, TOKEN } from "./helpers";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

function setup(initialUser = null as ReturnType<typeof makeUser> | null) {
  const fake = createFakeManager(initialUser);
  const logout = { clientId: "client-123", logoutUri: "https://app.example.com/" };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider manager={fake.manager} logout={logout}>
      {children}
    </AuthProvider>
  );
  const hook = renderHook(() => useAuth(), { wrapper });
  return { ...fake, ...hook };
}

const storedText = () =>
  JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });

describe("estado de sesión inicial", () => {
  it("sin usuario guardado queda no autenticado (los tokens no sobreviven a una recarga)", async () => {
    const { result } = setup(null);
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
    expect(result.current.getAccessToken()).toBeNull();
    expect(result.current.groups).toEqual([]);
  });

  it("con una sesión vigente queda autenticado y expone el access token y los grupos (solo UX)", async () => {
    const { result } = setup(makeUser({ profile: { "cognito:groups": ["GESTOR"] } }));
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current.getAccessToken()).toBe(TOKEN);
    expect(result.current.groups).toEqual(["GESTOR"]);
  });

  it("un token expirado no cuenta como sesión", async () => {
    const { result } = setup(makeUser({ expired: true }));
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
    expect(result.current.getAccessToken()).toBeNull();
  });

  it("un usuario sin access_token no cuenta como sesión", async () => {
    const { result } = setup(makeUser({ access_token: "" }));
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
  });

  it("si getUser falla queda no autenticado, sin romper la aplicación", async () => {
    const fake = createFakeManager();
    fake.manager.getUser.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider manager={fake.manager}>{children}</AuthProvider>,
    });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
  });

  it("los grupos que no son texto se descartan", async () => {
    const { result } = setup(makeUser({ profile: { "cognito:groups": ["DONANTE", 5, null] } }));
    await waitFor(() => expect(result.current.groups).toEqual(["DONANTE"]));
  });

  it("un claim de grupos que no es un arreglo no concede nada", async () => {
    const { result } = setup(makeUser({ profile: { "cognito:groups": "GESTOR" } }));
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current.groups).toEqual([]);
  });

  it("el access token expira por sí solo: getAccessToken deja de devolverlo", async () => {
    const user = makeUser();
    const { result } = setup(user);
    await waitFor(() => expect(result.current.getAccessToken()).toBe(TOKEN));
    (user as { expired: boolean }).expired = true;
    expect(result.current.getAccessToken()).toBeNull();
  });
});

describe("login (Authorization Code + PKCE)", () => {
  it("redirige al proveedor guardando la ruta de retorno", async () => {
    const { result, manager } = setup();
    await act(() => result.current.login("/me/donations"));
    expect(manager.signinRedirect).toHaveBeenCalledWith({ state: { returnTo: "/me/donations" } });
  });

  it.each([
    ["https://evil.example/x", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["relativa", "/"],
    ["/callback", "/"],
    ["/callback?code=1", "/"],
    ["/ok\nSet-Cookie: x", "/"],
    [undefined, "/"],
    [42, "/"],
    ["/me/donations?x=1", "/me/donations?x=1"],
  ])("sanitiza la ruta de retorno %j", async (input, expected) => {
    expect(sanitizeReturnTo(input)).toBe(expected);
    const { result, manager } = setup();
    await act(() => result.current.login(input as string));
    expect(manager.signinRedirect).toHaveBeenCalledWith({ state: { returnTo: expected } });
  });

  it("si la redirección falla muestra un mensaje seguro y no lanza", async () => {
    const { result, manager } = setup();
    manager.signinRedirect.mockRejectedValueOnce(new Error("detalle interno del IdP"));
    await act(() => result.current.login());
    await waitFor(() => expect(result.current.error).toMatch(/inicio de sesión/));
    expect(result.current.error).not.toContain("detalle interno");
  });
});

describe("completeLogin", () => {
  it("guarda la sesión en memoria y devuelve la ruta de retorno", async () => {
    const { result, manager } = setup();
    manager.signinRedirectCallback.mockResolvedValueOnce(
      makeUser({ state: { returnTo: "/me/donations" } }),
    );
    let returnTo: string | null = null;
    await act(async () => {
      returnTo = await result.current.completeLogin();
    });
    expect(returnTo).toBe("/me/donations");
    expect(result.current.status).toBe("authenticated");
    expect(result.current.getAccessToken()).toBe(TOKEN);
  });

  it("una ruta de retorno maliciosa en el estado se reemplaza por /", async () => {
    const { result, manager } = setup();
    manager.signinRedirectCallback.mockResolvedValueOnce(
      makeUser({ state: { returnTo: "//evil.example" } }),
    );
    let returnTo: string | null = null;
    await act(async () => {
      returnTo = await result.current.completeLogin();
    });
    expect(returnTo).toBe("/");
  });

  it("sin estado de retorno vuelve a /", async () => {
    const { result } = setup();
    let returnTo: string | null = null;
    await act(async () => {
      returnTo = await result.current.completeLogin();
    });
    expect(returnTo).toBe("/");
  });

  it("si el callback falla (p. ej. state inválido) queda sin sesión y con mensaje seguro", async () => {
    const { result, manager } = setup();
    manager.signinRedirectCallback.mockRejectedValueOnce(new Error("No matching state found: abc"));
    let returnTo: string | null = "x";
    await act(async () => {
      returnTo = await result.current.completeLogin();
    });
    expect(returnTo).toBeNull();
    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.getAccessToken()).toBeNull();
    expect(result.current.error).toMatch(/No se pudo completar/);
    expect(result.current.error).not.toContain("abc");
  });

  it("un callback que devuelve un usuario ya expirado no deja sesión", async () => {
    const { result, manager } = setup();
    manager.signinRedirectCallback.mockResolvedValueOnce(makeUser({ expired: true }));
    await act(async () => {
      await result.current.completeLogin();
    });
    expect(result.current.status).toBe("unauthenticated");
  });
});

describe("logout (principio V)", () => {
  async function authenticated() {
    const ctx = setup(makeUser());
    await waitFor(() => expect(ctx.result.current.status).toBe("authenticated"));
    return ctx;
  }

  it("revoca el refresh token, elimina los tokens de memoria y cierra la sesión del proveedor", async () => {
    const { result, manager } = await authenticated();
    await act(() => result.current.logout());

    expect(manager.revokeTokens).toHaveBeenCalledWith(["refresh_token"]);
    expect(manager.removeUser).toHaveBeenCalledTimes(1);
    expect(manager.signoutRedirect).toHaveBeenCalledWith({
      extraQueryParams: { client_id: "client-123", logout_uri: "https://app.example.com/" },
    });
    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.getAccessToken()).toBeNull();
    expect(result.current.groups).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("revoca ANTES de eliminar al usuario (la revocación necesita el refresh token)", async () => {
    const { result, manager } = await authenticated();
    await act(() => result.current.logout());
    const revoke = manager.revokeTokens.mock.invocationCallOrder[0]!;
    const remove = manager.removeUser.mock.invocationCallOrder[0]!;
    const signout = manager.signoutRedirect.mock.invocationCallOrder[0]!;
    expect(revoke).toBeLessThan(remove);
    expect(remove).toBeLessThan(signout);
  });

  it("si la revocación falla igualmente borra los tokens y avisa al usuario", async () => {
    const { result, manager } = await authenticated();
    manager.revokeTokens.mockRejectedValueOnce(new Error("revocation_endpoint no disponible"));
    await act(() => result.current.logout());

    expect(result.current.getAccessToken()).toBeNull();
    expect(result.current.status).toBe("unauthenticated");
    expect(manager.removeUser).toHaveBeenCalled();
    expect(manager.signoutRedirect).toHaveBeenCalled();
    expect(result.current.error).toMatch(/no se pudo revocar/i);
    expect(result.current.error).not.toContain("revocation_endpoint");
  });

  it("si removeUser o signoutRedirect fallan, la sesión local ya está limpia", async () => {
    const { result, manager } = await authenticated();
    manager.removeUser.mockRejectedValueOnce(new Error("x"));
    manager.signoutRedirect.mockRejectedValueOnce(new Error("y"));
    await act(() => result.current.logout());
    expect(result.current.getAccessToken()).toBeNull();
    expect(result.current.status).toBe("unauthenticated");
  });

  it("sin parámetros de logout llama a signoutRedirect sin extras", async () => {
    const fake = createFakeManager(makeUser());
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider manager={fake.manager}>{children}</AuthProvider>,
    });
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    await act(() => result.current.logout());
    expect(fake.manager.signoutRedirect).toHaveBeenCalledWith(undefined);
  });
});

describe("los tokens no se persisten en Web Storage", () => {
  it("tras login, uso y logout no queda ningún token en localStorage ni sessionStorage", async () => {
    const { result, manager } = setup();
    manager.signinRedirectCallback.mockResolvedValueOnce(makeUser());
    await act(async () => {
      await result.current.completeLogin();
    });
    expect(result.current.getAccessToken()).toBe(TOKEN);
    expect(storedText()).not.toMatch(/SECRET|access_token|refresh_token/);

    await act(() => result.current.logout());
    expect(storedText()).not.toMatch(/SECRET|access_token|refresh_token/);
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });
});

describe("eventos del proveedor", () => {
  it("userLoaded autentica (renovación silenciosa) y userUnloaded cierra la sesión", async () => {
    const { result, emit } = setup();
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    act(() => emit("userLoaded", makeUser({ access_token: "RENOVADO" })));
    expect(result.current.getAccessToken()).toBe("RENOVADO");

    act(() => emit("userUnloaded"));
    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.getAccessToken()).toBeNull();
  });

  it("al expirar el access token se descarta la sesión", async () => {
    const { result, emit } = setup(makeUser());
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    act(() => emit("accessTokenExpired"));
    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.getAccessToken()).toBeNull();
  });

  it("un error de renovación muestra un mensaje seguro", async () => {
    const { result, emit } = setup(makeUser());
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    act(() => emit("silentRenewError", new Error("invalid_grant: refresh token revoked")));
    expect(result.current.error).toMatch(/no pudo renovarse/);
    expect(result.current.error).not.toContain("invalid_grant");
  });

  it("al desmontar se eliminan todos los manejadores", async () => {
    const { unmount, listenerCount, result } = setup();
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
    expect(listenerCount("userLoaded")).toBe(1);
    unmount();
    for (const name of ["userLoaded", "userUnloaded", "accessTokenExpired", "silentRenewError"]) {
      expect(listenerCount(name)).toBe(0);
    }
  });

  it("un evento tardío tras desmontar no actualiza el estado", async () => {
    const fake = createFakeManager(makeUser());
    let resolveUser: (user: ReturnType<typeof makeUser>) => void = () => {};
    fake.manager.getUser.mockImplementationOnce(
      () => new Promise((resolve) => (resolveUser = resolve)),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider manager={fake.manager}>{children}</AuthProvider>,
    });
    unmount();
    await act(async () => resolveUser(makeUser()));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("useAuth", () => {
  it("lanza un error claro fuera de <AuthProvider>", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow(/AuthProvider/);
    spy.mockRestore();
  });
});
