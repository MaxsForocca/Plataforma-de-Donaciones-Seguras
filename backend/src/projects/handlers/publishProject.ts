/**
 * PATCH /v1/projects/{projectId}/publish (T067; CA-08.2). Solo GESTOR (`project:publish`). Un id
 * malformado o inexistente responde el mismo 404 uniforme (sin tocar la base de datos si es
 * malformado); un proyecto ya publicado responde 409. La autorización va antes que cualquier lectura,
 * así que un DONANTE recibe 403 aunque el proyecto no exista.
 */
import { uuidSchema } from "@donaciones/shared";
import {
  authConfigFromEnv,
  withAuth,
  type AuthConfig,
  type AuthEvent,
} from "../../authz/middleware";
import { getConfig } from "../../shared/config";
import { getDocumentClient } from "../../shared/dynamodb";
import { lazyHandler, type HandlerDeps } from "../../shared/handler";
import { jsonResponse, notFound } from "../../shared/http";
import { createProjectsWriteRepository, type ProjectsWriteRepository } from "../repository";

export interface PublishProjectDeps extends HandlerDeps {
  repository: Pick<ProjectsWriteRepository, "publishProject">;
  config: AuthConfig;
  now?: () => number;
}

export function buildPublishProjectHandler(deps: PublishProjectDeps) {
  return withAuth<AuthEvent>(
    {
      name: "publishProject",
      action: "project:publish",
      config: deps.config,
      now: deps.now,
      createLogger: deps.createLogger,
    },
    async ({ event, principal, requestId }) => {
      // El id sale únicamente de la ruta; el cuerpo y la query no intervienen.
      const projectId = uuidSchema.safeParse(event.pathParameters?.projectId);
      if (!projectId.success) throw notFound("id de proyecto inválido");

      const project = await deps.repository.publishProject({
        actorSub: principal.sub,
        requestId,
        projectId: projectId.data,
      });
      return jsonResponse(200, project);
    },
  );
}

export const handler = lazyHandler<AuthEvent>(() => {
  const { tables } = getConfig();
  return buildPublishProjectHandler({
    repository: createProjectsWriteRepository(getDocumentClient(), {
      projects: tables.projects,
      audit: tables.audit,
    }),
    config: authConfigFromEnv(),
  });
});
