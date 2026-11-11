/**
 * POST /v1/donations (T074; CA-05.1–CA-05.5). Solo DONANTE (`donation:create`). El `donorSub` sale del
 * token verificado; el cuerpo solo aporta `projectId` y `amountCents` (los demás campos se ignoran
 * para la lógica, pero forman parte de la huella de idempotencia). Orden: autenticación y rol →
 * cabecera `Idempotency-Key` → cuerpo → repositorio (404 por proyecto inexistente antes de
 * transaccionar; 409 por conflicto de clave o proyecto no publicado).
 */
import { donationCreateRequestSchema } from "@donaciones/shared";
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
import { readIdempotencyKey } from "../../shared/idempotency";
import { createDonationsRepository, type DonationsRepository } from "../repository";

export interface CreateDonationDeps extends HandlerDeps {
  repository: Pick<DonationsRepository, "createDonation">;
  config: AuthConfig;
  now?: () => number;
}

export function buildCreateDonationHandler(deps: CreateDonationDeps) {
  return withAuth<AuthEvent>(
    {
      name: "createDonation",
      action: "donation:create",
      config: deps.config,
      now: deps.now,
      createLogger: deps.createLogger,
    },
    async ({ event, principal, requestId }) => {
      const idempotencyKey = readIdempotencyKey(event.headers);
      // El JSON completo es la carga canónica; el esquema solo valida lo que el backend usa.
      const payload = parseJsonBody(event.body, event.isBase64Encoded);
      const { projectId, amountCents } = donationCreateRequestSchema.parse(payload);

      const result = await deps.repository.createDonation({
        donorSub: principal.sub,
        requestId,
        idempotencyKey,
        payload,
        input: { projectId, amountCents },
      });
      return jsonResponse(result.statusCode, result.donation);
    },
  );
}

export const handler = lazyHandler<AuthEvent>(() =>
  buildCreateDonationHandler({
    repository: createDonationsRepository(getDocumentClient(), getConfig().tables),
    config: authConfigFromEnv(),
  }),
);
