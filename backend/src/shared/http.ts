/**
 * Respuestas HTTP y errores uniformes (T017). Todo rechazo usa el sobre `{ code, message, requestId }`
 * con mensajes genéricos: no revelan datos internos, de otros usuarios ni el motivo exacto de un
 * 403/404 (FR-023, constitución «Restricciones de stack y seguridad»).
 */
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ZodError } from "zod";
import type { ErrorCode, ErrorEnvelope } from "@donaciones/shared";

export type { ErrorCode, ErrorEnvelope };

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  INVALID_AMOUNT: 400,
  MISSING_IDEMPOTENCY_KEY: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

/** Mensajes fijos en español, aptos para el usuario y sin detalles internos. */
const MESSAGE_BY_CODE: Record<ErrorCode, string> = {
  INVALID_REQUEST: "La solicitud no es válida.",
  INVALID_AMOUNT: "El importe debe ser un entero entre 100 y 100000 céntimos.",
  MISSING_IDEMPOTENCY_KEY: "Falta una Idempotency-Key válida.",
  UNAUTHORIZED: "Se requiere autenticación válida.",
  FORBIDDEN: "No tiene permiso para realizar esta acción.",
  NOT_FOUND: "El recurso solicitado no existe.",
  CONFLICT: "La solicitud entra en conflicto con el estado actual del recurso.",
  INTERNAL_ERROR: "Ocurrió un error interno. Inténtelo nuevamente.",
};

/** Error de aplicación con código estable; el mensaje público depende solo del código. */
export class AppError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: ErrorCode,
    /** Detalle solo para logs internos; nunca se envía al cliente. */
    readonly internalDetail?: string,
  ) {
    super(internalDetail ?? MESSAGE_BY_CODE[code]);
    this.name = "AppError";
    this.statusCode = STATUS_BY_CODE[code];
  }

  get publicMessage(): string {
    return MESSAGE_BY_CODE[this.code];
  }
}

export const badRequest = (
  code: Extract<
    ErrorCode,
    "INVALID_REQUEST" | "INVALID_AMOUNT" | "MISSING_IDEMPOTENCY_KEY"
  > = "INVALID_REQUEST",
  detail?: string,
) => new AppError(code, detail);
export const unauthorized = (detail?: string) => new AppError("UNAUTHORIZED", detail);
export const forbidden = (detail?: string) => new AppError("FORBIDDEN", detail);
export const notFound = (detail?: string) => new AppError("NOT_FOUND", detail);
export const conflict = (detail?: string) => new AppError("CONFLICT", detail);
export const internalError = (detail?: string) => new AppError("INTERNAL_ERROR", detail);

const BASE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: { ...BASE_HEADERS }, body: JSON.stringify(body) };
}

export function errorEnvelope(code: ErrorCode, requestId: string): ErrorEnvelope {
  return { code, message: MESSAGE_BY_CODE[code], requestId };
}

/** Convierte cualquier error en una respuesta uniforme; los desconocidos se vuelven 500 genéricos. */
export function toErrorResponse(
  error: unknown,
  requestId: string,
): APIGatewayProxyStructuredResultV2 {
  const appError = toAppError(error);
  return jsonResponse(appError.statusCode, errorEnvelope(appError.code, requestId));
}

/** Normaliza un error cualquiera a `AppError` (errores de validación Zod → 400). */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    const onAmount = error.issues.some((issue) => issue.path[0] === "amountCents");
    return badRequest(onAmount ? "INVALID_AMOUNT" : "INVALID_REQUEST");
  }
  return internalError(error instanceof Error ? error.name : "unknown");
}

/** Identificador de correlación de la solicitud (API Gateway) o `unknown`. */
export function getRequestId(event: { requestContext?: { requestId?: string } }): string {
  const id = event.requestContext?.requestId;
  return typeof id === "string" && id.length > 0 ? id : "unknown";
}

export const MAX_BODY_BYTES = 16 * 1024;

/** Parsea el cuerpo JSON de una solicitud; cualquier problema produce 400 uniforme. */
export function parseJsonBody(body: string | null | undefined, isBase64Encoded = false): unknown {
  if (typeof body !== "string" || body.length === 0)
    throw badRequest("INVALID_REQUEST", "sin cuerpo");
  const text = isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw badRequest("INVALID_REQUEST", "cuerpo demasiado grande");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest("INVALID_REQUEST", "JSON inválido");
  }
}
