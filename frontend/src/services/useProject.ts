/**
 * Hook para consultar el detalle de un proyecto publicado (T094; CA-02.1, CA-02.2).
 * Ruta pública: no envía el access token. Valida el resultado con `projectSchema`.
 */
import { projectSchema, type Project } from "@donaciones/shared";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "./apiClient";
import { useApiClient } from "./useApiClient";

export function useProject(projectId: string | undefined) {
  const api = useApiClient();
  return useQuery<Project, Error>({
    queryKey: ["project", projectId],
    enabled: Boolean(projectId),
    queryFn: async ({ signal }) => {
      if (!projectId) {
        throw new ApiError(404, "NOT_FOUND", "Identificador de proyecto no proporcionado.");
      }
      const payload = await api.get<unknown>(`/v1/projects/${projectId}`, { signal });
      const parsed = projectSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ApiError(502, "INVALID_RESPONSE", "La respuesta del servidor no es válida.");
      }
      return parsed.data;
    },
  });
}
