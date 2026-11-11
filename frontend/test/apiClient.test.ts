import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "../src/services/apiClient";
import { TOKEN } from "./helpers";

const BASE = "https://api.example.com/academic";

function jsonResponse(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(
  respond: () => Response | Promise<Response> = () => jsonResponse(200, { ok: true }),
) {
  const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => respond());
  let token: string | null = TOKEN;
  const client = createApiClient({
    baseUrl: BASE,
    getAccessToken: () => token,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return {
    client,
    fetchImpl,
    setToken: (value: string | null) => (token = value),
    lastInit: () => fetchImpl.mock.calls.at(-1)?.[1] as RequestInit,
    lastHeaders: () =>
      (fetchImpl.mock.calls.at(-1)?.[1] as RequestInit).headers as Record<string, string>,
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("Se esperaba un rechazo");
    },
    (error: unknown) => error,
  );
}

describe("inyección del access token", () => {
  it("auth: true adjunta Authorization: Bearer con el token actual", async () => {
    const { client, lastHeaders } = setup();
    await client.get("/v1/donations/me", { auth: true });
    expect(lastHeaders().authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("lee el token en cada solicitud (se actualiza tras una renovación)", async () => {
    const { client, lastHeaders, setToken } = setup();
    setToken("token-1");
    await client.get("/v1/donations/me", { auth: true });
    expect(lastHeaders().authorization).toBe("Bearer token-1");
    setToken("token-2");
    await client.get("/v1/donations/me", { auth: true });
    expect(lastHeaders().authorization).toBe("Bearer token-2");
  });

  it("las rutas públicas nunca envían el token, aunque exista sesión", async () => {
    const { client, lastHeaders } = setup();
    await client.get("/v1/projects");
    expect(lastHeaders().authorization).toBeUndefined();
  });

  it("auth: true sin token lanza 401 sin llamar a la red", async () => {
    const { client, fetchImpl, setToken } = setup();
    setToken(null);
    const error = (await rejection(client.get("/v1/donations/me", { auth: true }))) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.code).toBe("UNAUTHORIZED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("un token vacío cuenta como sin sesión", async () => {
    const { client, fetchImpl, setToken } = setup();
    setToken("");
    await rejection(client.get("/v1/donations/me", { auth: true }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["Authorization", "authorization", "AUTHORIZATION"])(
    "el llamador no puede sobrescribir la cabecera %s",
    async (name) => {
      const { client, lastHeaders } = setup();
      await client.get("/v1/donations/me", { auth: true, headers: { [name]: "Bearer falso" } });
      expect(lastHeaders().authorization).toBe(`Bearer ${TOKEN}`);
      expect(
        Object.keys(lastHeaders()).filter((key) => key.toLowerCase() === "authorization"),
      ).toHaveLength(1);
    },
  );

  it("sin auth tampoco se cuela una Authorization del llamador", async () => {
    const { client, lastHeaders } = setup();
    await client.get("/v1/projects", { headers: { Authorization: "Bearer falso" } });
    expect(Object.keys(lastHeaders()).map((k) => k.toLowerCase())).not.toContain("authorization");
  });

  it("el token no aparece en los mensajes de error", async () => {
    const { client } = setup(() =>
      jsonResponse(401, {
        code: "UNAUTHORIZED",
        message: "Se requiere autenticación válida.",
        requestId: "r1",
      }),
    );
    const error = (await rejection(client.get("/v1/donations/me", { auth: true }))) as ApiError;
    expect(`${error.message} ${error.code} ${error.requestId}`).not.toContain(TOKEN);
  });
});

describe("solo rutas relativas a la API (el token no puede ir a otro origen)", () => {
  it.each([
    "https://evil.example/steal",
    "http://evil.example",
    "//evil.example/x",
    "///evil.example",
    "v1/projects",
    "",
    "\\\\evil.example",
    "/v1\\evil",
    "/v1/projects\nHost: evil",
    "javascript:alert(1)",
  ])("rechaza la ruta %j antes de llamar a la red", async (path) => {
    const { client, fetchImpl } = setup();
    await expect(client.get(path, { auth: true })).rejects.toThrow(TypeError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["not a url", "ftp://example.com", "", "//example.com", "javascript:alert(1)"])(
    "rechaza una baseUrl inválida (%j)",
    (baseUrl) => {
      expect(() => createApiClient({ baseUrl, getAccessToken: () => null })).toThrow(TypeError);
    },
  );

  it("normaliza barras finales de la baseUrl", async () => {
    const fetchImpl = vi.fn(async (_url: string) => jsonResponse(200, {}));
    const client = createApiClient({
      baseUrl: `${BASE}///`,
      getAccessToken: () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.get("/v1/projects");
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`${BASE}/v1/projects`);
  });
});

describe("solicitudes", () => {
  it("get no envía cuerpo ni content-type", async () => {
    const { client, lastInit, lastHeaders } = setup();
    await client.get("/v1/projects");
    expect(lastInit().method).toBe("GET");
    expect(lastInit().body).toBeUndefined();
    expect(lastHeaders()["content-type"]).toBeUndefined();
  });

  it("post serializa el cuerpo JSON y reenvía Idempotency-Key", async () => {
    const { client, lastInit, lastHeaders } = setup();
    await client.post(
      "/v1/donations",
      { projectId: "p", amountCents: 500 },
      { auth: true, headers: { "Idempotency-Key": "3b241101-e2bb-4255-8caf-4136c566a962" } },
    );
    expect(lastInit().method).toBe("POST");
    expect(lastInit().body).toBe('{"projectId":"p","amountCents":500}');
    expect(lastHeaders()["content-type"]).toBe("application/json");
    expect(lastHeaders()["Idempotency-Key"]).toBe("3b241101-e2bb-4255-8caf-4136c566a962");
  });

  it("patch usa el verbo PATCH", async () => {
    const { client, lastInit } = setup();
    await client.patch("/v1/projects/x/publish", undefined, { auth: true });
    expect(lastInit().method).toBe("PATCH");
  });

  it("no envía cookies ni usa caché del navegador", async () => {
    const { client, lastInit } = setup();
    await client.get("/v1/projects");
    expect(lastInit().credentials).toBe("omit");
    expect(lastInit().cache).toBe("no-store");
  });

  it("reenvía la señal de cancelación", async () => {
    const { client, lastInit } = setup();
    const controller = new AbortController();
    await client.get("/v1/projects", { signal: controller.signal });
    expect(lastInit().signal).toBe(controller.signal);
  });

  it("un importe se envía como número entero, no como texto", async () => {
    const { client, lastInit } = setup();
    await client.post("/v1/donations", { amountCents: 500 }, { auth: true });
    expect(JSON.parse(lastInit().body as string).amountCents).toBe(500);
  });
});

describe("respuestas", () => {
  it("devuelve el JSON de una respuesta correcta", async () => {
    const { client } = setup(() => jsonResponse(200, [{ projectId: "p" }]));
    await expect(client.get("/v1/projects")).resolves.toEqual([{ projectId: "p" }]);
  });

  it.each([200, 201, 204])("un cuerpo vacío (%i) devuelve undefined", async (status) => {
    const { client } = setup(() => new Response(status === 204 ? null : "", { status }));
    await expect(client.get("/v1/x")).resolves.toBeUndefined();
  });

  it("un éxito con JSON inválido es INVALID_RESPONSE, sin filtrar el contenido", async () => {
    const { client } = setup(() => new Response("{secreto", { status: 200 }));
    const error = (await rejection(client.get("/v1/x"))) as ApiError;
    expect(error.code).toBe("INVALID_RESPONSE");
    expect(error.message).not.toContain("secreto");
  });
});

describe("errores", () => {
  const envelope = { code: "CONFLICT", message: "Conflicto de estado.", requestId: "req-9" };

  it.each([400, 401, 403, 404, 409, 500])(
    "convierte el sobre de error uniforme (HTTP %i)",
    async (status) => {
      const { client } = setup(() => jsonResponse(status, envelope));
      const error = (await rejection(client.get("/v1/x"))) as ApiError;
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        status,
        code: "CONFLICT",
        message: envelope.message,
        requestId: "req-9",
      });
    },
  );

  it.each([
    ["HTML del proxy", new Response("<html>stack interno</html>", { status: 502 })],
    ["JSON sin forma de sobre", jsonResponse(500, { error: "boom" })],
    [
      "sobre con campos extra (p. ej. stack)",
      jsonResponse(500, { ...envelope, stack: "at x.js:1" }),
    ],
    ["sobre incompleto", jsonResponse(500, { code: "X" })],
    ["cuerpo vacío", new Response(null, { status: 503 })],
    ["JSON inválido", new Response("{", { status: 500 })],
  ])("%s → error genérico sin detalles", async (_label, response) => {
    const { client } = setup(() => response);
    const error = (await rejection(client.get("/v1/x"))) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBeGreaterThanOrEqual(500);
    expect(error.message).toBe("Ocurrió un error inesperado. Inténtelo nuevamente.");
    expect(error.message).not.toMatch(/stack|boom|html/i);
  });

  it("un fallo de red es NETWORK_ERROR (estado 0) sin exponer el error original", async () => {
    const { client } = setup(() => {
      throw new TypeError("fetch failed: ECONNREFUSED 10.0.0.5:443");
    });
    const error = (await rejection(client.get("/v1/x"))) as ApiError;
    expect(error).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
    expect(error.message).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
  });

  it("una cancelación (AbortError) se propaga tal cual para que TanStack Query la ignore", async () => {
    const abort = new DOMException("cancelado", "AbortError");
    const { client } = setup(() => {
      throw abort;
    });
    await expect(client.get("/v1/x")).rejects.toBe(abort);
  });
});
