import { type ApiClient } from "./apiClient";
/** Cliente de API que lee el access token de la sesión en memoria en cada solicitud. */
export declare function useApiClient(baseUrl?: string): ApiClient;
