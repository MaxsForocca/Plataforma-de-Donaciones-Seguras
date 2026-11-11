/**
 * Envoltorio común de handlers: correlación por `requestId`, log estructurado y errores uniformes.
 * Cualquier excepción se convierte en el sobre `{ code, message, requestId }`; nunca se filtra el
 * detalle interno (constitución, «Restricciones de stack y seguridad»).
 */
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { getRequestId, internalError, toAppError, toErrorResponse } from "./http";
import { createLogger, type Logger } from "./logger";

export interface HandlerDeps {
  createLogger?: (requestId: string) => Logger;
}

type EventWithRequestId = { requestContext?: { requestId?: string } };

export async function runHandler(
  event: EventWithRequestId,
  action: string,
  deps: HandlerDeps,
  run: () => Promise<APIGatewayProxyStructuredResultV2>,
): Promise<APIGatewayProxyStructuredResultV2> {
  const requestId = getRequestId(event);
  const logger = (deps.createLogger ?? createLogger)(requestId);
  const elapsed = logger.startTimer();

  try {
    const response = await run();
    logger.info({
      action,
      result: "success",
      statusCode: response.statusCode,
      durationMs: elapsed(),
    });
    return response;
  } catch (error) {
    const appError = toAppError(error);
    const serverError = appError.statusCode >= 500;
    logger[serverError ? "error" : "warn"]({
      action,
      result: serverError ? "error" : "denied",
      statusCode: appError.statusCode,
      durationMs: elapsed(),
      errorCode: appError.code,
    });
    return toErrorResponse(appError, requestId);
  }
}

/**
 * Construye el handler real de forma perezosa (la configuración se lee en la primera invocación) y
 * convierte un fallo de configuración en un 500 uniforme en lugar de un error de Lambda.
 */
export function lazyHandler<E extends EventWithRequestId>(
  factory: () => (event: E) => Promise<APIGatewayProxyStructuredResultV2>,
): (event: E) => Promise<APIGatewayProxyStructuredResultV2> {
  let built: ((event: E) => Promise<APIGatewayProxyStructuredResultV2>) | undefined;
  return async (event) => {
    try {
      built ??= factory();
    } catch {
      return toErrorResponse(internalError("configuración inválida"), getRequestId(event));
    }
    return built(event);
  };
}
