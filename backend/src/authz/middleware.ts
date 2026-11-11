/**
 * Middleware de autenticación y autorización (T054; constitución, principio I). Envuelve la lógica
 * de un caso de uso protegido:
 *
 *   1. `buildPrincipal`: identidad y roles solo desde el contexto verificado del authorizer; exige
 *      `token_use=access`, el `client_id` y el emisor propios y que no haya vencido (401 uniforme).
 *   2. `authorize`: RBAC por rol y scope (403 uniforme). La propiedad del recurso (404 uniforme) se
 *      aplica dentro del caso de uso con `authorizeOwned`, una vez leído el recurso persistido.
 *   3. La lógica de negocio solo se ejecuta si ambas pasan; cualquier error se vuelve el sobre
 *      uniforme `{ code, message, requestId }` sin detalles internos.
 *
 * Falla cerrado: sin `clientId` y `issuer` configurados el middleware no se puede construir.
 * Los rechazos se registran en logs estructurados (resultado `denied`); no se escribe en
 * `AuditEvents` para no ampliar el IAM de funciones de lectura (ver evidence/auth-pending-deployment.md).
 */
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { getConfig } from "../shared/config";
import { getRequestId } from "../shared/http";
import { runHandler, type HandlerDeps } from "../shared/handler";
import { authorize, type Action } from "./policies";
import { buildPrincipal, type Principal, type PrincipalSource } from "./principal";

export interface AuthConfig {
  clientId: string;
  issuer: string;
}

export type AuthEvent = PrincipalSource & {
  requestContext?: { requestId?: string };
  pathParameters?: Record<string, string | undefined> | null;
  queryStringParameters?: Record<string, string | undefined> | null;
  headers?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
};

export interface AuthContext<E extends AuthEvent = AuthEvent> {
  event: E;
  principal: Principal;
  requestId: string;
}

export interface WithAuthOptions extends HandlerDeps {
  /** Nombre de la operación para los logs (p. ej. `createProject`). */
  name: string;
  action: Action;
  config: AuthConfig;
  /** Reloj en milisegundos (inyectable en pruebas). */
  now?: () => number;
}

/** Cliente y emisor de Cognito tomados de la configuración del entorno (variables de la Lambda). */
export function authConfigFromEnv(): AuthConfig {
  const { cognito } = getConfig();
  return { clientId: cognito.clientId, issuer: cognito.issuer };
}

export function withAuth<E extends AuthEvent = AuthEvent>(
  options: WithAuthOptions,
  handler: (context: AuthContext<E>) => Promise<APIGatewayProxyStructuredResultV2>,
): (event: E) => Promise<APIGatewayProxyStructuredResultV2> {
  if (!options.config.clientId || !options.config.issuer) {
    throw new TypeError("withAuth requiere clientId y issuer: no se puede autenticar sin ellos");
  }

  return (event) =>
    runHandler(event, options.name, options, async () => {
      const principal = buildPrincipal(event, {
        expectedClientId: options.config.clientId,
        expectedIssuer: options.config.issuer,
        now: options.now,
      });
      authorize(principal, options.action);
      return handler({ event, principal, requestId: getRequestId(event) });
    });
}
