import { describe, expect, it, vi } from "vitest";
import { lazyHandler, runHandler } from "../../../src/shared/handler";
import { conflict, forbidden, jsonResponse } from "../../../src/shared/http";
import { createLogger } from "../../../src/shared/logger";

const event = { requestContext: { requestId: "req-7" } };
function setup() {
  const lines: string[] = [];
  const deps = { createLogger: (id: string) => createLogger(id, { sink: (l) => lines.push(l) }) };
  return { lines, deps, entries: () => lines.map((l) => JSON.parse(l)) };
}

describe("runHandler", () => {
  it("devuelve la respuesta y registra éxito con requestId, acción, estado y duración", async () => {
    const { deps, entries } = setup();
    const response = await runHandler(event, "accion", deps, async () =>
      jsonResponse(200, { ok: 1 }),
    );
    expect(response.statusCode).toBe(200);
    expect(entries()[0]).toMatchObject({
      level: "info",
      requestId: "req-7",
      action: "accion",
      result: "success",
      statusCode: 200,
    });
    expect(typeof entries()[0].durationMs).toBe("number");
  });

  it.each([
    ["403", forbidden("detalle"), 403, "FORBIDDEN"],
    ["409", conflict("detalle"), 409, "CONFLICT"],
  ])(
    "un error de cliente %s se registra como denied/warn y responde el sobre uniforme",
    async (_l, error, status, code) => {
      const { deps, entries } = setup();
      const response = await runHandler(event, "a", deps, async () => {
        throw error;
      });
      expect(response.statusCode).toBe(status);
      expect(JSON.parse(response.body as string)).toMatchObject({ code, requestId: "req-7" });
      expect(entries()[0]).toMatchObject({ level: "warn", result: "denied", errorCode: code });
    },
  );

  it("un error inesperado es 500 genérico, se registra como error y no filtra el mensaje", async () => {
    const { deps, entries, lines } = setup();
    const response = await runHandler(event, "a", deps, async () => {
      throw new Error("secreto: contraseña=xyz");
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("xyz");
    expect(entries()[0]).toMatchObject({ level: "error", result: "error", statusCode: 500 });
    expect(lines.join("")).not.toContain("xyz");
  });

  it("sin requestId usa 'unknown'", async () => {
    const { deps, entries } = setup();
    await runHandler({}, "a", deps, async () => jsonResponse(200, {}));
    expect(entries()[0].requestId).toBe("unknown");
  });
});

describe("lazyHandler", () => {
  it("construye el handler una sola vez, en la primera invocación", async () => {
    const inner = vi.fn(async () => jsonResponse(200, {}));
    const factory = vi.fn(() => inner);
    const handler = lazyHandler(factory);
    expect(factory).not.toHaveBeenCalled();
    await handler(event);
    await handler(event);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("un fallo de configuración al construirlo es un 500 uniforme sin detalles", async () => {
    const handler = lazyHandler(() => {
      throw new Error("COGNITO_ISSUER inválido: https://interno.example");
    });
    const response = await handler(event);
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body as string)).toMatchObject({
      code: "INTERNAL_ERROR",
      requestId: "req-7",
    });
    expect(response.body).not.toContain("interno.example");
  });
});
