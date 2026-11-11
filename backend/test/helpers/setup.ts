/**
 * Arnés de pruebas del backend (T028): contexto del authorizer, configuración, definiciones de las
 * cuatro tablas y utilidades para DynamoDB Local (opcional) o un cliente que solo registra comandos.
 *
 * Ninguna prueba usa credenciales de AWS: DynamoDB Local solo se usa si se define
 * `DYNAMODB_LOCAL_ENDPOINT` (localhost) y recibe credenciales ficticias fijas.
 */
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  type CreateTableCommandInput,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { loadConfig, type AppConfig } from "../../src/shared/config";
import type { DocClient } from "../../src/shared/dynamodb";
import { AUDITOR_SUB, DONOR_A_SUB, MANAGER_SUB } from "./fixtures";

export const TEST_CLIENT_ID = "test-client-id";
export const TEST_ISSUER = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TEST";
/** Instante fijo de referencia: 2026-11-11T12:00:00Z. */
export const FIXED_NOW_MS = Date.parse("2026-11-11T12:00:00.000Z");
export const TEST_REQUEST_ID = "test-request-id";

// --- Configuración ----------------------------------------------------------------------------

export function testEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    STAGE: "academic",
    PROJECTS_TABLE: "testProjects",
    DONATIONS_TABLE: "testDonations",
    IDEMPOTENCY_TABLE: "testIdempotency",
    AUDIT_TABLE: "testAuditEvents",
    COGNITO_ISSUER: TEST_ISSUER,
    COGNITO_CLIENT_ID: TEST_CLIENT_ID,
    ALLOWED_ORIGINS: "http://localhost:5173",
    ...overrides,
  };
}

export function testConfig(overrides: Record<string, string | undefined> = {}): AppConfig {
  return loadConfig(testEnv(overrides));
}

/**
 * Configuración con tablas propias por archivo de prueba: los archivos de integración se ejecutan en
 * paralelo y cada uno recrea sus tablas, por lo que no pueden compartir nombres.
 */
export function isolatedConfig(prefix: string): AppConfig {
  return testConfig({
    PROJECTS_TABLE: `${prefix}Projects`,
    DONATIONS_TABLE: `${prefix}Donations`,
    IDEMPOTENCY_TABLE: `${prefix}Idempotency`,
    AUDIT_TABLE: `${prefix}AuditEvents`,
  });
}

// --- Contexto del authorizer ------------------------------------------------------------------

export interface JwtEventOptions {
  sub?: string;
  /** Grupos de Cognito; `null` omite el claim. Se serializa como lo hace HTTP API: `[A B]`. */
  groups?: readonly string[] | string | null;
  scopes?: readonly string[] | null;
  tokenUse?: string | null;
  clientId?: string | null;
  issuer?: string | null;
  /** Segundos hasta la expiración (negativo = ya expirado); `null` omite `exp`. */
  expiresInSeconds?: number | null;
  /** Reemplaza o añade claims arbitrarios (valor `undefined` elimina el claim). */
  claims?: Record<string, unknown>;
  /** `false` elimina por completo el contexto del authorizer (solicitud sin token). */
  authorizer?: boolean;
  body?: unknown;
  /** Cuerpo textual tal cual (permite JSON inválido, espacios, notación 1e2, base64…). */
  rawBody?: string;
  isBase64Encoded?: boolean;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  pathParameters?: Record<string, string>;
  method?: string;
  path?: string;
  requestId?: string;
}

export function buildJwtEvent(
  options: JwtEventOptions = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const scopes = options.scopes === undefined ? [] : options.scopes;
  const claims: Record<string, unknown> = {};

  claims.sub = options.sub ?? DONOR_A_SUB;
  if (options.tokenUse !== null) claims.token_use = options.tokenUse ?? "access";
  if (options.clientId !== null) claims.client_id = options.clientId ?? TEST_CLIENT_ID;
  if (options.issuer !== null) claims.iss = options.issuer ?? TEST_ISSUER;
  if (options.expiresInSeconds !== null) {
    claims.exp = String(Math.floor(FIXED_NOW_MS / 1000) + (options.expiresInSeconds ?? 900));
  }
  if (options.groups !== null) {
    const groups = options.groups ?? ["DONANTE"];
    claims["cognito:groups"] = typeof groups === "string" ? groups : `[${groups.join(" ")}]`;
  }
  if (scopes !== null) claims.scope = ["openid", ...scopes].join(" ");

  for (const [key, value] of Object.entries(options.claims ?? {})) {
    if (value === undefined) delete claims[key];
    else claims[key] = value;
  }

  const method = options.method ?? "GET";
  const path = options.path ?? "/v1/projects";
  const body =
    options.rawBody !== undefined
      ? options.rawBody
      : options.body === undefined
        ? undefined
        : JSON.stringify(options.body);

  return {
    version: "2.0",
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: new URLSearchParams(options.query ?? {}).toString(),
    headers: { ...(options.headers ?? {}) },
    queryStringParameters: options.query,
    pathParameters: options.pathParameters,
    ...(body === undefined ? {} : { body }),
    isBase64Encoded: options.isBase64Encoded ?? false,
    requestContext: {
      accountId: "000000000000",
      apiId: "testapi",
      domainName: "testapi.execute-api.us-east-1.amazonaws.com",
      domainPrefix: "testapi",
      http: { method, path, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "vitest" },
      requestId: options.requestId ?? TEST_REQUEST_ID,
      routeKey: `${method} ${path}`,
      stage: "academic",
      time: "11/Nov/2026:12:00:00 +0000",
      timeEpoch: FIXED_NOW_MS,
      ...(options.authorizer === false
        ? {}
        : {
            authorizer: {
              jwt: {
                claims: claims as Record<string, string>,
                scopes: scopes === null ? (null as unknown as string[]) : [...scopes],
              },
            },
          }),
    },
  } as APIGatewayProxyEventV2WithJWTAuthorizer;
}

/** Eventos de cada rol con los scopes que le corresponden. */
export const donanteEvent = (options: JwtEventOptions = {}) =>
  buildJwtEvent({
    sub: DONOR_A_SUB,
    groups: ["DONANTE"],
    scopes: ["api/donations.read", "api/donations.write"],
    ...options,
  });
export const gestorEvent = (options: JwtEventOptions = {}) =>
  buildJwtEvent({
    sub: MANAGER_SUB,
    groups: ["GESTOR"],
    scopes: ["api/projects.write"],
    ...options,
  });
export const auditorEvent = (options: JwtEventOptions = {}) =>
  buildJwtEvent({ sub: AUDITOR_SUB, groups: ["AUDITOR"], scopes: ["api/audit.read"], ...options });

// --- Tablas DynamoDB (según data-model.md) ----------------------------------------------------

export function tableDefinitions(config: AppConfig): CreateTableCommandInput[] {
  return [
    {
      TableName: config.tables.projects,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "projectId", AttributeType: "S" },
        { AttributeName: "status", AttributeType: "S" },
        { AttributeName: "createdAt", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "projectId", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: "status-createdAt",
          KeySchema: [
            { AttributeName: "status", KeyType: "HASH" },
            { AttributeName: "createdAt", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
    },
    {
      TableName: config.tables.donations,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "donationId", AttributeType: "S" },
        { AttributeName: "donorSub", AttributeType: "S" },
        { AttributeName: "createdAt", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "donationId", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: "donorSub-createdAt",
          KeySchema: [
            { AttributeName: "donorSub", KeyType: "HASH" },
            { AttributeName: "createdAt", KeyType: "RANGE" },
          ],
          Projection: {
            ProjectionType: "INCLUDE",
            NonKeyAttributes: ["projectId", "amountCents", "currency", "status", "updatedAt"],
          },
        },
      ],
    },
    {
      TableName: config.tables.idempotency,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
    },
    {
      TableName: config.tables.audit,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "eventType", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "eventType", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
    },
  ];
}

// --- DynamoDB Local (opcional) ----------------------------------------------------------------

export const LOCAL_ENDPOINT = process.env.DYNAMODB_LOCAL_ENDPOINT;

/** `true` solo si hay un endpoint local explícito (localhost / 127.0.0.1). */
export function hasLocalDynamo(): boolean {
  if (!LOCAL_ENDPOINT) return false;
  try {
    return ["localhost", "127.0.0.1"].includes(new URL(LOCAL_ENDPOINT).hostname);
  } catch {
    return false;
  }
}

export function createLocalClients() {
  if (!hasLocalDynamo()) throw new Error("DYNAMODB_LOCAL_ENDPOINT no está definido o no es local");
  const raw = new DynamoDBClient({
    endpoint: LOCAL_ENDPOINT,
    region: "us-east-1",
    // Credenciales ficticias exclusivas del emulador local; no son credenciales de AWS.
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
  const doc = DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return { raw, doc };
}

/** Recrea las cuatro tablas (las borra si existen). */
export async function resetTables(raw: DynamoDBClient, config: AppConfig): Promise<void> {
  for (const definition of tableDefinitions(config)) {
    try {
      await raw.send(new DeleteTableCommand({ TableName: definition.TableName! }));
    } catch (error) {
      if ((error as { name?: string }).name !== "ResourceNotFoundException") throw error;
    }
    await raw.send(new CreateTableCommand(definition));
  }
}

// --- Cliente que solo registra comandos -------------------------------------------------------

export interface RecordedCall {
  name: string;
  input: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface RecordingClient extends DocClient {
  calls: RecordedCall[];
}

/** Doble de `DocClient`: registra cada comando y responde con `respond` (por defecto `{}`). */
export function createRecordingClient(
  respond: (call: RecordedCall) => unknown = () => ({}),
): RecordingClient {
  const calls: RecordedCall[] = [];
  return {
    calls,
    send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const call = { name: command.constructor.name, input: command.input };
      calls.push(call);
      const result = respond(call);
      if (result instanceof Error) throw result;
      return result;
    }) as unknown as DocClient["send"],
  };
}
