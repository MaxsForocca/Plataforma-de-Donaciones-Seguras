import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./apiClient";

const MAX_RETRIES = 2;

/** No reintenta errores 4xx (son deterministas); reintenta fallos de red y 5xx hasta 2 veces. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < MAX_RETRIES;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetry, refetchOnWindowFocus: false },
      // Las mutaciones (donar, simular) no se reintentan solas: la idempotencia la decide el usuario.
      mutations: { retry: false },
    },
  });
}
