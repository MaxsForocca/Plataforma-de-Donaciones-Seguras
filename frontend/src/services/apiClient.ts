/**
 * Cliente HTTP de la API (T030). Inyecta `Authorization: Bearer` solo cuando la llamada lo pide, nunca
 * envía el token a otro origen y convierte los errores en `ApiError` con mensajes seguros.
 * La SPA no decide autorización: solo adjunta el access token y muestra lo que el backend resuelve.
 */
import { errorEnvelopeSchema } from "@donaciones/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string = "",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  /** URL base de la API (p. ej. la salida `ApiUrl` de la pila SAM). */
  baseUrl: string;
  /** Devuelve el access token actual (en memoria) o `null` si no hay sesión. */
  getAccessToken: () => string | null | undefined;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  /** `true` para rutas protegidas: exige y adjunta el access token. */
  auth?: boolean;
  body?: unknown;
  /** Cabeceras adicionales (p. ej. `Idempotency-Key`). `Authorization` no se puede sobrescribir. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const GENERIC_MESSAGE = "Ocurrió un error inesperado. Inténtelo nuevamente.";

function normalizeBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new TypeError("baseUrl debe ser una URL absoluta http(s)");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("baseUrl debe ser una URL absoluta http(s)");
  }
  return baseUrl.replace(/\/+$/, "");
}

/** Solo rutas relativas a la API: `//host`, `http://…` o `\` podrían desviar el token a otro origen. */
function assertRelativePath(path: string): void {
  if (!/^\/(?![/\\])/.test(path) || path.includes("\\") || /[\r\n]/.test(path)) {
    throw new TypeError("La ruta debe empezar con '/' y ser relativa a la API");
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  return JSON.parse(text) as unknown;
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request<T>(method: string, path: string, init: RequestOptions = {}): Promise<T> {
    assertRelativePath(path);

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(init.headers ?? {})) {
      if (name.toLowerCase() !== "authorization") headers[name] = value;
    }
    headers.accept = "application/json";
    if (init.body !== undefined) headers["content-type"] = "application/json";

    if (init.auth) {
      const token = options.getAccessToken();
      if (!token) throw new ApiError(401, "UNAUTHORIZED", "Inicie sesión para continuar.");
      headers.authorization = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: init.signal,
        credentials: "omit",
        cache: "no-store",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ApiError(0, "NETWORK_ERROR", "No se pudo conectar con el servidor.");
    }

    let payload: unknown;
    try {
      payload = await readBody(response);
    } catch {
      throw new ApiError(response.status, "INVALID_RESPONSE", GENERIC_MESSAGE);
    }

    if (!response.ok) {
      const envelope = errorEnvelopeSchema.safeParse(payload);
      if (envelope.success) {
        throw new ApiError(
          response.status,
          envelope.data.code,
          envelope.data.message,
          envelope.data.requestId,
        );
      }
      throw new ApiError(response.status, "UNKNOWN_ERROR", GENERIC_MESSAGE);
    }
    return payload as T;
  }

  return {
    request,
    get: <T>(path: string, init?: Omit<RequestOptions, "body">) => request<T>("GET", path, init),
    post: <T>(path: string, body?: unknown, init?: Omit<RequestOptions, "body">) =>
      request<T>("POST", path, { ...init, body }),
    patch: <T>(path: string, body?: unknown, init?: Omit<RequestOptions, "body">) =>
      request<T>("PATCH", path, { ...init, body }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
