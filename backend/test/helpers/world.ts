/**
 * "Mundo" de pruebas: los MISMOS handlers reales cableados a un almacén en memoria (doble con
 * transacciones atómicas) o a DynamoDB Local. Permite ejecutar un mismo escenario en ambos entornos.
 * Nunca usa AWS.
 */
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { buildCreateDonationHandler } from "../../src/donations/handlers/createDonation";
import { buildSimulateDonationHandler } from "../../src/donations/handlers/simulateDonation";
import { createDonationsRepository, type DonationsDeps } from "../../src/donations/repository";
import { buildCreateProjectHandler } from "../../src/projects/handlers/createProject";
import { createListProjectsHandler } from "../../src/projects/handlers/listProjects";
import { buildPublishProjectHandler } from "../../src/projects/handlers/publishProject";
import {
  createProjectsRepository,
  createProjectsWriteRepository,
} from "../../src/projects/repository";
import type { AppConfig } from "../../src/shared/config";
import type { DocClient } from "../../src/shared/dynamodb";
import { createLogger } from "../../src/shared/logger";
import { createFakeTables, type FakeTables } from "./fakeTables";
import { ALL_DONATIONS, PUBLISHED_PROJECT } from "./fixtures";
import {
  createLocalClients,
  donanteEvent,
  FIXED_NOW_MS,
  isolatedConfig,
  resetTables,
  TEST_CLIENT_ID,
  TEST_ISSUER,
  testConfig,
  type RecordedCall,
} from "./setup";

type Item = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type TableKey = "projects" | "donations" | "idempotency" | "audit";

export interface World {
  label: string;
  config: AppConfig;
  client: DocClient;
  listProjects: ReturnType<typeof createListProjectsHandler>;
  createProject: ReturnType<typeof buildCreateProjectHandler>;
  publishProject: ReturnType<typeof buildPublishProjectHandler>;
  createDonation: ReturnType<typeof buildCreateDonationHandler>;
  simulateDonation: ReturnType<typeof buildSimulateDonationHandler>;
  dump(table: TableKey): Promise<Item[]>;
  /** Comandos enviados (solo el entorno en memoria los registra). */
  calls(): RecordedCall[];
  /** Solo en memoria: inyección de fallos. */
  fake?: FakeTables;
}

export const DEFAULT_KEY = "3b241101-e2bb-4255-8caf-4136c566a962";
export const AUTH_CONFIG = { clientId: TEST_CLIENT_ID, issuer: TEST_ISSUER };
export const silentLogger = (id: string) => createLogger(id, { sink: () => {} });
const deps = { config: AUTH_CONFIG, now: () => FIXED_NOW_MS, createLogger: silentLogger };

function wire(
  label: string,
  config: AppConfig,
  client: DocClient,
  extra: Partial<World>,
  donationDeps: DonationsDeps = {},
): World {
  const writeTables = { projects: config.tables.projects, audit: config.tables.audit };
  return {
    label,
    config,
    client,
    listProjects: createListProjectsHandler({
      repository: createProjectsRepository(client, config.tables.projects),
      createLogger: silentLogger,
    }),
    createProject: buildCreateProjectHandler({
      repository: createProjectsWriteRepository(client, writeTables),
      ...deps,
    }),
    publishProject: buildPublishProjectHandler({
      repository: createProjectsWriteRepository(client, writeTables),
      ...deps,
    }),
    createDonation: buildCreateDonationHandler({
      repository: createDonationsRepository(client, config.tables, donationDeps),
      ...deps,
    }),
    simulateDonation: buildSimulateDonationHandler({
      repository: createDonationsRepository(client, config.tables, donationDeps),
      academicStage: true,
      ...deps,
    }),
    dump: async () => [],
    calls: () => [],
    ...extra,
  };
}

export function makeMemoryWorld(
  seed: Partial<Record<TableKey, readonly object[]>> = {},
  donationDeps: DonationsDeps = { sleep: async () => {} },
): World {
  const config = testConfig();
  const fake = createFakeTables(config, seed);
  return wire(
    "memoria",
    config,
    fake.client,
    {
      fake,
      dump: async (table) => fake.dump(table),
      calls: () => fake.client.calls,
    },
    donationDeps,
  );
}

export async function makeLocalWorld(
  prefix: string,
  seed: Partial<Record<TableKey, readonly object[]>> = {},
): Promise<World> {
  const config = isolatedConfig(prefix);
  const { raw, doc } = createLocalClients();
  await resetTables(raw, config);
  const { PutCommand } = await import("@aws-sdk/lib-dynamodb");
  const tableOf = (table: TableKey) => config.tables[table];
  for (const [table, items] of Object.entries(seed) as [TableKey, readonly object[]][]) {
    for (const item of items)
      await doc.send(new PutCommand({ TableName: tableOf(table), Item: item }));
  }
  return wire("DynamoDB Local", config, doc, {
    dump: async (table) =>
      ((await doc.send(new ScanCommand({ TableName: tableOf(table), ConsistentRead: true })))
        .Items ?? []) as Item[],
  });
}

/** Evento de `POST /v1/donations` de un DONANTE (cabecera Idempotency-Key en minúsculas, como API Gateway). */
export function donationEvent(
  body: unknown,
  options: Parameters<typeof donanteEvent>[0] & { key?: string | null } = {},
) {
  const { key = DEFAULT_KEY, headers, ...rest } = options;
  return donanteEvent({
    method: "POST",
    path: "/v1/donations",
    requestId: "req-d",
    ...rest,
    headers: { ...(key === null ? {} : { "idempotency-key": key }), ...headers },
    ...(typeof body === "string" ? { rawBody: body } : { body }),
  });
}

/** Evento de `POST /v1/donations/{donationId}/simulate` de un DONANTE (por defecto, el de las fixtures). */
export function simulateEvent(
  donationId: string,
  outcome: unknown = "CONFIRMADA_SIMULADA",
  options: Parameters<typeof donanteEvent>[0] = {},
) {
  return donanteEvent({
    method: "POST",
    path: `/v1/donations/${donationId}/simulate`,
    pathParameters: { donationId },
    requestId: "req-s",
    ...options,
    ...(typeof outcome === "string" && outcome.startsWith("{")
      ? { rawBody: outcome }
      : { body: typeof outcome === "string" ? { outcome } : outcome }),
  });
}

/** Semilla con proyecto publicado (acumulado coherente con las donaciones confirmadas) y donaciones en todos los estados. */
export function simulationSeed() {
  return {
    projects: [{ ...PUBLISHED_PROJECT }],
    donations: ALL_DONATIONS.map((donation) => ({ ...donation })),
  };
}
