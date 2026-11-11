import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApiClient } from "../src/services/useApiClient";
import { fakeAuth, withAuth } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

function stubFetch() {
  const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const headersOf = (mock: ReturnType<typeof stubFetch>) =>
  (mock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].headers as Record<string, string>;

describe("useApiClient", () => {
  it("adjunta el access token de la sesión en memoria a las rutas protegidas", async () => {
    const fetchMock = stubFetch();
    const { result } = renderHook(() => useApiClient("https://api.example.com/academic"), {
      wrapper: withAuth(fakeAuth({ status: "authenticated", getAccessToken: () => "tok-1" })),
    });
    await result.current.get("/v1/donations/me", { auth: true });
    expect(headersOf(fetchMock).authorization).toBe("Bearer tok-1");
  });

  it("toma el token vigente en cada solicitud (sin reconstruir el cliente)", async () => {
    const fetchMock = stubFetch();
    let token: string | null = "tok-1";
    const { result } = renderHook(() => useApiClient("https://api.example.com/academic"), {
      wrapper: withAuth(fakeAuth({ getAccessToken: () => token })),
    });
    await result.current.get("/v1/donations/me", { auth: true });
    expect(headersOf(fetchMock).authorization).toBe("Bearer tok-1");
    token = "tok-2";
    await result.current.get("/v1/donations/me", { auth: true });
    expect(headersOf(fetchMock).authorization).toBe("Bearer tok-2");
  });

  it("sin sesión rechaza las rutas protegidas sin llamar a la red", async () => {
    const fetchMock = stubFetch();
    const { result } = renderHook(() => useApiClient("https://api.example.com/academic"), {
      wrapper: withAuth(fakeAuth({ getAccessToken: () => null })),
    });
    await expect(result.current.get("/v1/donations/me", { auth: true })).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mantiene el mismo cliente mientras no cambian la URL ni la sesión", () => {
    stubFetch();
    const value = fakeAuth();
    const { result, rerender } = renderHook(
      () => useApiClient("https://api.example.com/academic"),
      {
        wrapper: withAuth(value),
      },
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
