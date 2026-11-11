import { useMemo } from "react";
import { useAuth } from "../auth/AuthProvider";
import { createApiClient, type ApiClient } from "./apiClient";

/** Cliente de API que lee el access token de la sesión en memoria en cada solicitud. */
export function useApiClient(baseUrl: string = import.meta.env.VITE_API_BASE_URL ?? ""): ApiClient {
  const { getAccessToken } = useAuth();
  return useMemo(() => createApiClient({ baseUrl, getAccessToken }), [baseUrl, getAccessToken]);
}
