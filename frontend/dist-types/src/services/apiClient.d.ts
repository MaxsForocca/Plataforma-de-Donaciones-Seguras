export declare class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly requestId: string;
    constructor(status: number, code: string, message: string, requestId?: string);
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
export declare function createApiClient(options: ApiClientOptions): {
    request: <T>(method: string, path: string, init?: RequestOptions) => Promise<T>;
    get: <T>(path: string, init?: Omit<RequestOptions, "body">) => Promise<T>;
    post: <T>(path: string, body?: unknown, init?: Omit<RequestOptions, "body">) => Promise<T>;
    patch: <T>(path: string, body?: unknown, init?: Omit<RequestOptions, "body">) => Promise<T>;
};
export type ApiClient = ReturnType<typeof createApiClient>;
