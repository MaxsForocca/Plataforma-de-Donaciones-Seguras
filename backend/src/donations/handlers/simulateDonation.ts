/**
 * POST /v1/donations/{donationId}/simulate (T085; CA-06.1, CA-06.2, CA-07.2). Solo DONANTE propietario
 * (`donation:simulate`) y SOLO en el stage académico (FR-017). Orden: stage → autenticación y rol → id
 * de la ruta (404 uniforme si es malformado) → cuerpo estricto `{ outcome }` (400) → lectura de la
 * donación y propiedad (404 idéntico para ajena e inexistente; nunca revela su estado) → transacción
 * (409 si ya no está pendiente). El importe del incremento sale de lo almacenado, jamás del cliente.
 */
import { donationSimulateRequestSchema, uuidSchema } from "@donaciones/shared";
import {
  authConfigFromEnv,
  withAuth,
  type AuthConfig,
  type AuthEvent,
} from "../../authz/middleware";
import { authorizeOwned } from "../../authz/policies";
import { getConfig } from "../../shared/config";
import { getDocumentClient } from "../../shared/dynamodb";
import { lazyHandler, runHandler, type HandlerDeps } from "../../shared/handler";
import { jsonResponse, notFound, parseJsonBody } from "../../shared/http";
import { createDonationsRepository, type DonationsRepository } from "../repository";

export interface SimulateDonationDeps extends HandlerDeps {
  repository: Pick<DonationsRepository, "getDonation" | "simulateDonation">;
  config: AuthConfig;
  /** La ruta solo existe en el stage académico; fuera de él cualquier solicitud es un 404 uniforme. */
  academicStage: boolean;
  now?: () => number;
}

export function buildSimulateDonationHandler(deps: SimulateDonationDeps) {
  const protectedHandler = withAuth<AuthEvent>(
    {
      name: "simulateDonation",
      action: "donation:simulate",
      config: deps.config,
      now: deps.now,
      createLogger: deps.createLogger,
    },
    async ({ event, principal, requestId }) => {
      const donationId = uuidSchema.safeParse(event.pathParameters?.donationId);
      if (!donationId.success) throw notFound("id de donación inválido");

      const { outcome } = donationSimulateRequestSchema.parse(
        parseJsonBody(event.body, event.isBase64Encoded),
      );

      const stored = await deps.repository.getDonation(donationId.data);
      // Ajena o inexistente: el mismo 404; el estado de una donación ajena nunca se revela.
      authorizeOwned(principal, "donation:simulate", stored);

      const donation = await deps.repository.simulateDonation({
        donation: stored!,
        donorSub: principal.sub,
        outcome,
        requestId,
      });
      return jsonResponse(200, donation);
    },
  );

  return (event: AuthEvent) =>
    deps.academicStage
      ? protectedHandler(event)
      : // Defensa en profundidad: la plantilla ni siquiera crea esta ruta fuera de `academic`.
        runHandler(event, "simulateDonation", deps, async () => {
          throw notFound("ruta no disponible fuera del stage academic");
        });
}

export const handler = lazyHandler<AuthEvent>(() => {
  const config = getConfig();
  return buildSimulateDonationHandler({
    repository: createDonationsRepository(getDocumentClient(), config.tables),
    config: authConfigFromEnv(),
    academicStage: config.isAcademic,
  });
});
