/**
 * GET /v1/donations/me (T100; CA-07.1). Historial propio del donante autenticado.
 * Aplica el middleware withAuth con acción "donation:list-own" (exige rol DONANTE y scope api/donations.read).
 * El sub se toma exclusivamente del token verificado. Si no tiene donaciones responde 200 con [].
 */
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
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
import { jsonResponse } from "../../shared/http";
import { createDonationsRepository, type DonationsRepository } from "../repository";

export interface ListMyDonationsDeps extends HandlerDeps {
  repository: Pick<DonationsRepository, "listByDonor">;
  config: AuthConfig;
  now?: () => number;
}

export function buildListMyDonationsHandler(deps: ListMyDonationsDeps) {
  return withAuth<AuthEvent>(
    {
      name: "listMyDonations",
      action: "donation:list-own",
      config: deps.config,
      now: deps.now,
      createLogger: deps.createLogger,
    },
    async ({ principal }: AuthContext<AuthEvent>): Promise<APIGatewayProxyStructuredResultV2> => {
      const donations = await deps.repository.listByDonor(principal.sub);
      return jsonResponse(200, donations);
    },
  );
}

export const handler = lazyHandler<AuthEvent>(() => {
  const config = getConfig();
  return buildListMyDonationsHandler({
    repository: createDonationsRepository(getDocumentClient(), config.tables),
    config: authConfigFromEnv(),
  });
});
