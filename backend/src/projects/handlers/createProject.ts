/**
 * POST /v1/projects (T067; CA-08.1). Solo GESTOR (`project:create`). El estado inicial (BORRADOR), el
 * acumulado (0), el identificador y el propietario los fija el servidor; el esquema es estricto, por
 * lo que cualquier campo de "verdad" enviado por el navegador (status, confirmedAmountCents,
 * createdBySub, projectId…) se rechaza con 400. La autorización va ANTES de validar el cuerpo.
 */
import { projectCreateRequestSchema } from "@donaciones/shared";
import {
  authConfigFromEnv,
  withAuth,
  type AuthConfig,
  type AuthEvent,
} from "../../authz/middleware";
import { getConfig } from "../../shared/config";
import { getDocumentClient } from "../../shared/dynamodb";
import { lazyHandler, type HandlerDeps } from "../../shared/handler";
import { jsonResponse, parseJsonBody } from "../../shared/http";
import { createProjectsWriteRepository, type ProjectsWriteRepository } from "../repository";

export interface CreateProjectDeps extends HandlerDeps {
  repository: Pick<ProjectsWriteRepository, "createProject">;
  config: AuthConfig;
  /** Reloj en milisegundos (inyectable en pruebas). */
  now?: () => number;
}

export function buildCreateProjectHandler(deps: CreateProjectDeps) {
  return withAuth<AuthEvent>(
    {
      name: "createProject",
      action: "project:create",
      config: deps.config,
      now: deps.now,
      createLogger: deps.createLogger,
    },
    async ({ event, principal, requestId }) => {
      const input = projectCreateRequestSchema.parse(
        parseJsonBody(event.body, event.isBase64Encoded),
      );
      const project = await deps.repository.createProject({
        actorSub: principal.sub,
        requestId,
        input,
      });
      return jsonResponse(201, project);
    },
  );
}

export const handler = lazyHandler<AuthEvent>(() => {
  const { tables } = getConfig();
  return buildCreateProjectHandler({
    repository: createProjectsWriteRepository(getDocumentClient(), {
      projects: tables.projects,
      audit: tables.audit,
    }),
    config: authConfigFromEnv(),
  });
});
