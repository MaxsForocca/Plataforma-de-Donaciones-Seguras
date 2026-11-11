/**
 * GET /v1/projects/{projectId} (T092): detalle público de un proyecto PUBLICADO.
 * Devuelve el objeto Project completo sin exponer datos de donantes ni del creador (CA-02.1).
 * Un id malformado, inexistente o de un proyecto no publicado responde 404 uniforme,
 * sin consultar la base de datos cuando el id no es un UUID válido (CA-02.2).
 */
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { uuidSchema } from "@donaciones/shared";
import { getConfig } from "../../shared/config";
import { getDocumentClient } from "../../shared/dynamodb";
import { lazyHandler, runHandler, type HandlerDeps } from "../../shared/handler";
import { jsonResponse, notFound } from "../../shared/http";
import { createProjectsRepository, type ProjectsRepository } from "../repository";

export interface GetProjectDeps extends HandlerDeps {
  repository: Pick<ProjectsRepository, "getProject">;
}

interface DetailEvent {
  requestContext?: { requestId?: string };
  pathParameters?: Record<string, string | undefined> | null;
}

export function createGetProjectHandler(deps: GetProjectDeps) {
  return (event: DetailEvent): Promise<APIGatewayProxyStructuredResultV2> =>
    runHandler(event, "getProject", deps, async () => {
      // El id sale únicamente de la ruta; un id malformado ni siquiera llega a la base de datos.
      const projectId = uuidSchema.safeParse(event.pathParameters?.projectId);
      if (!projectId.success) throw notFound("id de proyecto inválido");

      const project = await deps.repository.getProject(projectId.data);
      if (!project) throw notFound("proyecto inexistente o no publicado");
      return jsonResponse(200, project);
    });
}

export const handler = lazyHandler<DetailEvent>(() =>
  createGetProjectHandler({
    repository: createProjectsRepository(getDocumentClient(), getConfig().tables.projects),
  }),
);
