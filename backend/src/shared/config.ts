/**
 * Configuración por entorno (T015). Se valida una sola vez y falla de forma explícita si falta algo,
 * sin incluir valores (posiblemente sensibles) en el mensaje de error.
 */
import { z } from "zod";

export const STAGES = ["academic", "dev"] as const;
export type Stage = (typeof STAGES)[number];

export interface AppConfig {
  readonly stage: Stage;
  /** La ruta de simulación solo existe en el stage académico (FR-017). */
  readonly isAcademic: boolean;
  readonly tables: {
    readonly projects: string;
    readonly donations: string;
    readonly idempotency: string;
    readonly audit: string;
  };
  readonly cognito: {
    readonly issuer: string;
    readonly clientId: string;
  };
  readonly allowedOrigins: readonly string[];
  /** Solo para DynamoDB Local en desarrollo; debe apuntar a localhost. */
  readonly dynamodbEndpoint?: string;
}

export class ConfigError extends Error {
  constructor(readonly invalidKeys: readonly string[]) {
    super(`Configuración inválida o incompleta: ${invalidKeys.join(", ")}`);
    this.name = "ConfigError";
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const tableName = z
  .string()
  .min(3)
  .max(255)
  .regex(/^[A-Za-z0-9_.-]+$/);

const envSchema = z.object({
  STAGE: z.enum(STAGES),
  PROJECTS_TABLE: tableName,
  DONATIONS_TABLE: tableName,
  IDEMPOTENCY_TABLE: tableName,
  AUDIT_TABLE: tableName,
  COGNITO_ISSUER: z.string().refine(isHttpsUrl, { message: "El emisor debe ser una URL https" }),
  COGNITO_CLIENT_ID: z.string().min(1).max(128),
  ALLOWED_ORIGINS: z.string().min(1),
  DYNAMODB_ENDPOINT: z.string().optional(),
});

/** Cada origen debe ser un origin exacto (sin comodín ni ruta); https salvo localhost. */
function parseOrigins(raw: string): string[] | null {
  const origins = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (origins.length === 0) return null;

  for (const origin of origins) {
    if (origin.includes("*")) return null; // ningún comodín, ni siquiera en subdominios
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return null;
    }
    if (url.origin !== origin) return null; // rechaza "*", rutas y barras finales
    const isLocal = LOCAL_HOSTS.has(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) return null;
  }
  return origins;
}

function parseLocalEndpoint(raw: string | undefined): string | null | undefined {
  if (raw === undefined || raw === "") return undefined;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || !LOCAL_HOSTS.has(url.hostname)) return null;
    return raw;
  } catch {
    return null;
  }
}

/** Construye la configuración desde un entorno (por defecto `process.env`). */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const keys = new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "ENV")));
    throw new ConfigError([...keys].sort());
  }
  const values = parsed.data;

  const origins = parseOrigins(values.ALLOWED_ORIGINS);
  if (origins === null) throw new ConfigError(["ALLOWED_ORIGINS"]);

  const endpoint = parseLocalEndpoint(values.DYNAMODB_ENDPOINT);
  if (endpoint === null) throw new ConfigError(["DYNAMODB_ENDPOINT"]);

  return Object.freeze({
    stage: values.STAGE,
    isAcademic: values.STAGE === "academic",
    tables: Object.freeze({
      projects: values.PROJECTS_TABLE,
      donations: values.DONATIONS_TABLE,
      idempotency: values.IDEMPOTENCY_TABLE,
      audit: values.AUDIT_TABLE,
    }),
    cognito: Object.freeze({ issuer: values.COGNITO_ISSUER, clientId: values.COGNITO_CLIENT_ID }),
    allowedOrigins: Object.freeze(origins),
    ...(endpoint === undefined ? {} : { dynamodbEndpoint: endpoint }),
  });
}

let cached: AppConfig | undefined;

/** Configuración del proceso, calculada una vez (útil en el cold start de Lambda). */
export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

/** Solo para pruebas. */
export function resetConfigCache(): void {
  cached = undefined;
}
