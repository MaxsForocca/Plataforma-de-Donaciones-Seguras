import { describe, expect, it } from "vitest";
import { errorEnvelopeSchema, donationCreateRequestSchema } from "@donaciones/shared";
import {
  AppError,
  badRequest,
  conflict,
  forbidden,
  getRequestId,
  internalError,
  jsonResponse,
  MAX_BODY_BYTES,
  notFound,
  parseJsonBody,
  toAppError,
  toErrorResponse,
  unauthorized,
  type ErrorCode,
} from "../../../src/shared/http";
import { PUBLISHED_PROJECT_ID } from "../../helpers/fixtures";

const CASES: [ErrorCode, number][] = [
  ["INVALID_REQUEST", 400],
  ["INVALID_AMOUNT", 400],
  ["MISSING_IDEMPOTENCY_KEY", 400],
  ["UNAUTHORIZED", 401],
  ["FORBIDDEN", 403],
  ["NOT_FOUND", 404],
  ["CONFLICT", 409],
  ["INTERNAL_ERROR", 500],
];

describe("AppError y fábricas", () => {
  it.each(CASES)("%s → HTTP %i", (code, status) => {
    const error = new AppError(code);
    expect(error.statusCode).toBe(status);
    expect(error.publicMessage.length).toBeGreaterThan(0);
  });

  it("las fábricas devuelven el código esperado", () => {
    expect(badRequest().code).toBe("INVALID_REQUEST");
    expect(badRequest("INVALID_AMOUNT").code).toBe("INVALID_AMOUNT");
    expect(unauthorized().statusCode).toBe(401);
    expect(forbidden().statusCode).toBe(403);
    expect(notFound().statusCode).toBe(404);
    expect(conflict().statusCode).toBe(409);
    expect(internalError().statusCode).toBe(500);
  });

  it("el mensaje público depende solo del código, nunca del detalle interno", () => {
    const a = forbidden("detalle sensible A");
    const b = forbidden("otro detalle B");
    expect(a.publicMessage).toBe(b.publicMessage);
    expect(a.publicMessage).not.toMatch(/sensible|detalle/);
  });
});

describe("toErrorResponse (FR-023: rechazos uniformes)", () => {
  it.each(CASES)(
    "%s produce el sobre { code, message, requestId } y el estado correcto",
    (code, status) => {
      const response = toErrorResponse(new AppError(code, "interno"), "req-123");
      expect(response.statusCode).toBe(status);
      const body = JSON.parse(response.body as string);
      expect(errorEnvelopeSchema.safeParse(body).success).toBe(true);
      expect(body).toEqual({
        code,
        message: new AppError(code).publicMessage,
        requestId: "req-123",
      });
    },
  );

  it("no filtra el detalle interno al cliente", () => {
    const response = toErrorResponse(notFound("donación d-99 de otro usuario"), "r");
    expect(response.body).not.toContain("d-99");
    expect(response.body).not.toContain("otro usuario");
  });

  it("un error desconocido es un 500 genérico sin mensaje ni pila", () => {
    const response = toErrorResponse(new Error("password=hunter2 en la conexión"), "r");
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("hunter2");
    expect(response.body).not.toContain("stack");
    expect(JSON.parse(response.body as string).code).toBe("INTERNAL_ERROR");
  });

  it.each([["texto lanzado"], [null], [undefined], [42], [{ secret: "x" }]])(
    "un valor no-Error lanzado (%j) también es 500 genérico",
    (thrown) => {
      const response = toErrorResponse(thrown, "r");
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain("secret");
    },
  );

  it("incluye cabeceras seguras y no cacheables", () => {
    const { headers } = toErrorResponse(unauthorized(), "r");
    expect(headers).toMatchObject({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
  });

  it("403 y 404 por motivos distintos producen cuerpos idénticos entre sí por código", () => {
    const body = (error: AppError) => toErrorResponse(error, "r").body;
    expect(body(forbidden("rol"))).toBe(body(forbidden("scope")));
    expect(body(notFound("no existe"))).toBe(body(notFound("es ajeno")));
  });
});

describe("toAppError con errores de validación Zod", () => {
  it("un importe inválido produce INVALID_AMOUNT (400)", () => {
    const result = donationCreateRequestSchema.safeParse({
      projectId: PUBLISHED_PROJECT_ID,
      amountCents: 99,
    });
    expect(result.success).toBe(false);
    const error = toAppError(result.error);
    expect(error.code).toBe("INVALID_AMOUNT");
    expect(error.statusCode).toBe(400);
  });

  it("un projectId inválido produce INVALID_REQUEST (400)", () => {
    const result = donationCreateRequestSchema.safeParse({ projectId: "x", amountCents: 100 });
    expect(toAppError(result.error).code).toBe("INVALID_REQUEST");
  });

  it("el mensaje no expone la ruta ni el valor rechazado", () => {
    const result = donationCreateRequestSchema.safeParse({
      projectId: PUBLISHED_PROJECT_ID,
      amountCents: -5,
    });
    const response = toErrorResponse(result.error, "r");
    expect(response.body).not.toContain("-5");
    expect(response.body).not.toContain("too_small");
  });

  it("conserva un AppError tal cual", () => {
    const original = conflict();
    expect(toAppError(original)).toBe(original);
  });
});

describe("jsonResponse y getRequestId", () => {
  it("serializa el cuerpo y fija el estado", () => {
    const response = jsonResponse(201, { ok: true });
    expect(response.statusCode).toBe(201);
    expect(response.body).toBe('{"ok":true}');
  });

  it("getRequestId usa el de API Gateway o 'unknown'", () => {
    expect(getRequestId({ requestContext: { requestId: "abc" } })).toBe("abc");
    expect(getRequestId({})).toBe("unknown");
    expect(getRequestId({ requestContext: { requestId: "" } })).toBe("unknown");
  });
});

describe("parseJsonBody", () => {
  const statusOf = (action: () => unknown) => {
    try {
      action();
    } catch (error) {
      return (error as AppError).statusCode;
    }
    return 200;
  };

  it("parsea un JSON válido", () => {
    expect(parseJsonBody('{"amountCents":500}')).toEqual({ amountCents: 500 });
  });

  it("decodifica base64 cuando API Gateway lo indica", () => {
    const encoded = Buffer.from('{"a":1}', "utf8").toString("base64");
    expect(parseJsonBody(encoded, true)).toEqual({ a: 1 });
  });

  it.each([undefined, null, ""])("cuerpo ausente (%j) → 400", (body) => {
    expect(statusOf(() => parseJsonBody(body))).toBe(400);
  });

  it.each(["{", "no es json", "{'a':1}", '{"a":1,}', "undefined"])(
    "JSON inválido %j → 400",
    (body) => {
      expect(statusOf(() => parseJsonBody(body))).toBe(400);
    },
  );

  it("acepta exactamente MAX_BODY_BYTES y rechaza un byte más", () => {
    const exact = `"${"a".repeat(MAX_BODY_BYTES - 2)}"`;
    expect(Buffer.byteLength(exact)).toBe(MAX_BODY_BYTES);
    expect(statusOf(() => parseJsonBody(exact))).toBe(200);
    expect(statusOf(() => parseJsonBody(`${exact} `))).toBe(400);
  });

  it("cuenta bytes y no caracteres (los caracteres multibyte pesan más)", () => {
    const body = `"${"€".repeat(Math.ceil(MAX_BODY_BYTES / 3))}"`;
    expect(body.length).toBeLessThan(MAX_BODY_BYTES);
    expect(statusOf(() => parseJsonBody(body))).toBe(400);
  });

  it("un JSON que es null o un valor primitivo se devuelve tal cual (la validación Zod lo rechaza)", () => {
    expect(parseJsonBody("null")).toBeNull();
    expect(parseJsonBody("123")).toBe(123);
  });

  it("una clave __proto__ en el cuerpo no contamina prototipos", () => {
    const parsed = parseJsonBody('{"__proto__":{"admin":true}}') as Record<string, unknown>;
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
    expect(Object.keys(parsed)).toEqual(["__proto__"]);
  });
});
