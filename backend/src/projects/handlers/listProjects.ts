/**
 * GET /v1/projects (T041): catálogo público de proyectos PUBLICADO. No requiere autenticación ni
 * lee identidad del cliente. El catálogo no se pagina (≤ 50 proyectos): cualquier parámetro de
 * consulta —incluidos `limit`, `cursor`, `page` u `offset`— se rechaza con 400 en lugar de
 * ignorarse en silencio.
 */
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { getConfig } from "../../shared/config";
import { getDocumentClient } from "../../shared/dynamodb";
import { runHandler, lazyHandler, type HandlerDeps } from "../../shared/handler";
import { badRequest, jsonResponse } from "../../shared/http";
import { createProjectsRepository, type ProjectsRepository } from "../repository";

export interface ListProjectsDeps extends HandlerDeps {
  repository: Pick<ProjectsRepository, "listPublished">;
}

interface ListEvent {
  requestContext?: { requestId?: string };
  queryStringParameters?: Record<string, string | undefined> | null;
  rawQueryString?: string;
}

function assertNoQuery(event: ListEvent): void {
  const hasParams =
    Object.keys(event.queryStringParameters ?? {}).length > 0 ||
    (event.rawQueryString ?? "").length > 0;
  if (hasParams) throw badRequest("INVALID_REQUEST", "parámetros de consulta no admitidos");
}

export function createListProjectsHandler(deps: ListProjectsDeps) {
  return (event: ListEvent): Promise<APIGatewayProxyStructuredResultV2> =>
    runHandler(event, "listProjects", deps, async () => {
      assertNoQuery(event);
      return jsonResponse(200, await deps.repository.listPublished());
    });
}

export const handler = lazyHandler<ListEvent>(() =>
  createListProjectsHandler({
    repository: createProjectsRepository(getDocumentClient(), getConfig().tables.projects),
  }),
);
