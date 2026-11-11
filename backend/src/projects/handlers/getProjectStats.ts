/**
 * GET /v1/projects/{projectId}/stats (T041): indicadores agregados públicos de un proyecto
 * PUBLICADO. Solo importes agregados en céntimos de PEN: sin donantes ni registros individuales
 * (CA-09.2). Un id malformado, inexistente o de un proyecto no publicado responde el mismo 404
 * uniforme, sin consultar la base de datos cuando el id es inválido (CA-02.2).
 */
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { uuidSchema } from "@donaciones/shared";
import { getConfig } from "../../shared/config";
import { getDocumentClient } from "../../shared/dynamodb";
import { lazyHandler, runHandler, type HandlerDeps } from "../../shared/handler";
import { jsonResponse, notFound } from "../../shared/http";
import { createProjectsRepository, type ProjectsRepository } from "../repository";

export interface GetProjectStatsDeps extends HandlerDeps {
  repository: Pick<ProjectsRepository, "getStats">;
}

interface StatsEvent {
  requestContext?: { requestId?: string };
  pathParameters?: Record<string, string | undefined> | null;
}

export function createGetProjectStatsHandler(deps: GetProjectStatsDeps) {
  return (event: StatsEvent): Promise<APIGatewayProxyStructuredResultV2> =>
    runHandler(event, "getProjectStats", deps, async () => {
      // El id sale únicamente de la ruta; un id malformado ni siquiera llega a la base de datos.
      const projectId = uuidSchema.safeParse(event.pathParameters?.projectId);
      if (!projectId.success) throw notFound("id de proyecto inválido");

      const stats = await deps.repository.getStats(projectId.data);
      if (!stats) throw notFound("proyecto inexistente o no publicado");
      return jsonResponse(200, stats);
    });
}

export const handler = lazyHandler<StatsEvent>(() =>
  createGetProjectStatsHandler({
    repository: createProjectsRepository(getDocumentClient(), getConfig().tables.projects),
  }),
);
