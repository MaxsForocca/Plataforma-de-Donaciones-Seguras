/**
 * Construcción del principal autenticado (T021; constitución, principio I).
 *
 * La identidad (`sub`) y los roles (`cognito:groups`) se derivan EXCLUSIVAMENTE de los claims que el
 * JWT authorizer de API Gateway ya verificó (`requestContext.authorizer.jwt`). Este módulo no lee
 * `body`, `headers`, `queryStringParameters` ni `pathParameters`, por lo que ningún valor enviado por
 * el cliente puede influir en la identidad ni en los roles. Como defensa en profundidad exige
 * `token_use=access` (un ID token se rechaza) y, si se configuran, `client_id` y emisor.
 */
import { ROLES, type Role } from "@donaciones/shared";
import { unauthorized } from "../shared/http";

export interface Principal {
  readonly sub: string;
  readonly roles: readonly Role[];
  readonly scopes: readonly string[];
  readonly clientId: string;
}

/** Forma mínima del evento de API Gateway HTTP API (payload v2) que se consulta. */
export interface PrincipalSource {
  requestContext?: {
    authorizer?: {
      jwt?: {
        claims?: Record<string, unknown>;
        scopes?: unknown;
      };
    };
  };
}

export interface PrincipalOptions {
  expectedClientId?: string;
  expectedIssuer?: string;
  /** Reloj en milisegundos (inyectable en pruebas). */
  now?: () => number;
}

/** `sub` sin `#` (separador de la clave de idempotencia) y con longitud acotada. */
const SUB_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * HTTP API serializa los claims de tipo arreglo como texto (`"[GESTOR DONANTE]"`); también se
 * admiten arreglos reales, JSON (`["GESTOR"]`) y un grupo único (`"GESTOR"`).
 */
export function parseListClaim(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === "string");
  if (typeof raw !== "string") return [];
  const text = raw.trim();
  if (text.length === 0) return [];

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string");
      }
    } catch {
      // no es JSON: se interpreta como "[a b]"
    }
    return text
      .slice(1, -1)
      .split(/[\s,]+/)
      .filter((item) => item.length > 0);
  }
  return text.split(/[\s,]+/).filter((item) => item.length > 0);
}

function toRoles(groups: readonly string[]): Role[] {
  const known = new Set<string>(ROLES);
  return [...new Set(groups.filter((group) => known.has(group)))] as Role[];
}

function expSeconds(value: unknown): number | null {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
}

/** Construye el principal o lanza 401 uniforme si el contexto no es un access token válido. */
export function buildPrincipal(event: PrincipalSource, options: PrincipalOptions = {}): Principal {
  const jwt = event.requestContext?.authorizer?.jwt;
  const claims = jwt?.claims;
  if (!claims || typeof claims !== "object") throw unauthorized("sin contexto del authorizer");

  if (claims.token_use !== "access") throw unauthorized("token_use distinto de access");

  const sub = claims.sub;
  if (typeof sub !== "string" || !SUB_PATTERN.test(sub)) throw unauthorized("sub inválido");

  const clientId = claims.client_id;
  if (typeof clientId !== "string" || clientId.length === 0) throw unauthorized("sin client_id");
  if (options.expectedClientId !== undefined && clientId !== options.expectedClientId) {
    throw unauthorized("client_id inesperado");
  }
  if (options.expectedIssuer !== undefined && claims.iss !== options.expectedIssuer) {
    throw unauthorized("emisor inesperado");
  }

  const exp = expSeconds(claims.exp);
  const nowSeconds = (options.now ?? Date.now)() / 1000;
  if (exp === null || exp <= nowSeconds) throw unauthorized("token expirado o sin exp");

  const scopes =
    jwt.scopes === undefined || jwt.scopes === null
      ? parseListClaim(claims.scope)
      : parseListClaim(jwt.scopes);

  return Object.freeze({
    sub,
    roles: Object.freeze(toRoles(parseListClaim(claims["cognito:groups"]))),
    scopes: Object.freeze([...new Set(scopes)]),
    clientId,
  });
}
