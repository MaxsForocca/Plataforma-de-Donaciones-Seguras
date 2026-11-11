import { QueryClient } from "@tanstack/react-query";
/** No reintenta errores 4xx (son deterministas); reintenta fallos de red y 5xx hasta 2 veces. */
export declare function shouldRetry(failureCount: number, error: unknown): boolean;
export declare function createQueryClient(): QueryClient;
