/**
 * Catálogo público de proyectos (compartido por CatalogPage y DonationPage). Ruta pública: no envía
 * el access token. La respuesta se valida con el esquema compartido y se rechaza completa si algún
 * proyecto es inválido (importes no enteros, campos de donantes, etc.).
 */
import { projectSummarySchema } from "@donaciones/shared";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError } from "./apiClient";
import { useApiClient } from "./useApiClient";

const projectListSchema = z.array(projectSummarySchema);

export function useProjects() {
  const api = useApiClient();
  return useQuery({
    queryKey: ["projects"],
    queryFn: async ({ signal }) => {
      const payload = await api.get<unknown>("/v1/projects", { signal });
      const parsed = projectListSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ApiError(502, "INVALID_RESPONSE", "La respuesta del servidor no es válida.");
      }
      return parsed.data;
    },
  });
}
