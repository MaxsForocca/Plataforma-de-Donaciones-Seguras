/**
 * GET /v1/donations/{donationId} (T100; CA-07.2). Detalle de una donación propia.
 * Aplica el middleware withAuth con acción "donation:read-own" (exige rol DONANTE y scope api/donations.read).
 * Un id malformado responde 404 uniforme sin consultar la base de datos.
 * Una donación ajena o inexistente responde el mismo 404 uniforme (prueba BOLA, nunca revela existencia).
 */
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { uuidSchema } from "@donaciones/shared";
import {
  authConfigFromEnv,
  withAuth,
  type AuthConfig,
  type AuthContext,
  type AuthEvent,
} from "../../authz/middleware";
import { getConfig } from "../../shared/config";
import { getDocumentClient } from "../../shared/dynamodb";
import { lazyHandler, type HandlerDeps } from "../../shared/handler";
import { jsonResponse, notFound } from "../../shared/http";
import { createDonationsRepository, type DonationsRepository } from "../repository";

export interface GetDonationDeps extends HandlerDeps {
  repository: Pick<DonationsRepository, "getById">;
  config: AuthConfig;
  now?: () => number;
}

export function buildGetDonationHandler(deps: GetDonationDeps) {
  return withAuth<AuthEvent>(
    {
      name: "getDonation",
      action: "donation:read-own",
      config: deps.config,
      now: deps.now,
      createLogger: deps.createLogger,
    },
    async ({ event, principal }: AuthContext<AuthEvent>): Promise<APIGatewayProxyStructuredResultV2> => {
      const donationId = uuidSchema.safeParse(event.pathParameters?.donationId);
      if (!donationId.success) throw notFound("id de donación inválido");

      const donation = await deps.repository.getById(donationId.data, principal.sub);
      if (!donation) throw notFound("donación no encontrada");

      return jsonResponse(200, donation);
    },
  );
}

export const handler = lazyHandler<AuthEvent>(() => {
  const config = getConfig();
  return buildGetDonationHandler({
    repository: createDonationsRepository(getDocumentClient(), config.tables),
    config: authConfigFromEnv(),
  });
});
