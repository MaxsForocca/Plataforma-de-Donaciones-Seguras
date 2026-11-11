/**
 * Escritura de eventos de auditoría (T020). Solo se escribe (HU-10, consulta, queda diferida).
 *
 * Los eventos NUNCA contienen tokens, claves de idempotencia, `sub` en claro, datos personales ni
 * financieros: el actor se seudonimiza y los metadatos pasan por una lista de exclusión.
 */
import { randomUUID } from "node:crypto";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { sha256Hex } from "@donaciones/shared/canonical";
import type { DocClient, TransactItem } from "../shared/dynamodb";

export const AUDIT_EVENT_TYPES = [
  "PROJECT_CREATED",
  "PROJECT_PUBLISHED",
  "DONATION_CREATED",
  "DONATION_CONFIRMED",
  "DONATION_REJECTED",
  "ACCESS_DENIED",
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];
export type AuditOutcome = "SUCCESS" | "DENIED";

export interface AuditEventInput {
  eventType: AuditEventType;
  requestId: string;
  /** `sub` verificado del actor; se seudonimiza antes de persistirse. */
  actorSub: string;
  action: string;
  /** `projectId` o `donationId`. */
  resourceRef: string;
  outcome: AuditOutcome;
  metadata?: Record<string, unknown>;
}

export interface AuditEventItem {
  eventType: AuditEventType;
  /** Clave de ordenación: `timestamp#eventId`. */
  sk: string;
  timestamp: string;
  eventId: string;
  requestId: string;
  actorRef: string;
  action: string;
  resourceRef: string;
  outcome: AuditOutcome;
  metadata?: Record<string, string | number | boolean>;
}

export interface AuditDeps {
  now?: () => Date;
  newId?: () => string;
}

const MAX_METADATA_KEYS = 10;
const MAX_STRING_LENGTH = 200;
const FIELD_LIMIT = 128;
/** Claves que podrían transportar secretos o datos personales/financieros. */
const SENSITIVE_KEY =
  /token|secret|password|authorization|bearer|cookie|card|cvv|cvc|dni|email|phone|account|idempotency|donorsub|^sub$/i;

/** Referencia seudonimizada y estable del actor; no es reversible sin conocer el `sub`. */
export function actorRef(sub: string): string {
  return `actor:${sha256Hex(sub).slice(0, 16)}`;
}

/** Conserva solo metadatos primitivos, acotados y sin claves sensibles. */
export function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!metadata) return undefined;
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (Object.keys(safe).length >= MAX_METADATA_KEYS) break;
    if (SENSITIVE_KEY.test(key)) continue;
    if (typeof value === "string") safe[key] = value.slice(0, MAX_STRING_LENGTH);
    else if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
    else if (typeof value === "boolean") safe[key] = value;
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function requireText(value: string, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > FIELD_LIMIT) {
    throw new TypeError(`Campo de auditoría inválido: ${field}`);
  }
  return value;
}

export function buildAuditEvent(input: AuditEventInput, deps: AuditDeps = {}): AuditEventItem {
  if (!AUDIT_EVENT_TYPES.includes(input.eventType)) {
    throw new TypeError("Tipo de evento de auditoría desconocido");
  }
  if (input.outcome !== "SUCCESS" && input.outcome !== "DENIED") {
    throw new TypeError("Resultado de auditoría inválido");
  }
  const timestamp = (deps.now ?? (() => new Date()))().toISOString();
  const eventId = (deps.newId ?? randomUUID)();
  const metadata = sanitizeMetadata(input.metadata);

  return {
    eventType: input.eventType,
    sk: `${timestamp}#${eventId}`,
    timestamp,
    eventId,
    requestId: requireText(input.requestId, "requestId"),
    actorRef: actorRef(requireText(input.actorSub, "actorSub")),
    action: requireText(input.action, "action"),
    resourceRef: requireText(input.resourceRef, "resourceRef"),
    outcome: input.outcome,
    ...(metadata ? { metadata } : {}),
  };
}

/** Item `Put` para incluir el evento en la misma `TransactWriteItems` que la operación. */
export function auditPutItem(tableName: string, event: AuditEventItem): TransactItem {
  return {
    Put: {
      TableName: tableName,
      Item: event,
      ConditionExpression: "attribute_not_exists(eventType)",
    },
  };
}

/** Escritura independiente (p. ej. `ACCESS_DENIED`, que no modifica estado). */
export async function writeAuditEvent(
  client: DocClient,
  tableName: string,
  event: AuditEventItem,
): Promise<void> {
  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: event,
      ConditionExpression: "attribute_not_exists(eventType)",
    }),
  );
}
