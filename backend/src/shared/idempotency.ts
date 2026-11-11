/**
 * Utilidades de idempotencia para la creación de donaciones (T019; constitución, principio IV).
 *
 * El registro se reserva con `attribute_not_exists(pk)` dentro del mismo `TransactWriteItems` que la
 * donación (T073); estas funciones solo construyen el registro, el item de la transacción y deciden
 * qué hacer cuando la reserva ya existe. Nunca se implementa con lectura seguida de escritura.
 *
 * El TTL (`expiresAt`) solo limpia registros: mientras el registro exista, una repetición con la
 * misma carga devuelve el resultado almacenado y con carga distinta responde 409.
 */
import { timingSafeEqual } from "node:crypto";
import { payloadHash } from "@donaciones/shared/canonical";
import { idempotencyKeySchema } from "@donaciones/shared";
import type { TransactItem } from "./dynamodb";
import { badRequest } from "./http";

export const IDEMPOTENCY_OPERATION = "createDonation" as const;
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export interface IdempotencyRecord {
  pk: string;
  donorSub: string;
  operation: typeof IDEMPOTENCY_OPERATION;
  idempotencyKey: string;
  payloadHash: string;
  donationId: string;
  responseStatus: number;
  createdAt: string;
  /** Epoch en segundos (TTL de DynamoDB). */
  expiresAt: number;
}

/** PK: `donorSub#createDonation#idempotencyKey`; aísla las claves por donante. */
export function buildIdempotencyPk(donorSub: string, idempotencyKey: string): string {
  if (typeof donorSub !== "string" || donorSub.length === 0 || donorSub.includes("#")) {
    throw new TypeError("donorSub inválido para la clave de idempotencia");
  }
  if (!idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw new TypeError("Idempotency-Key debe ser un UUID");
  }
  return `${donorSub}#${IDEMPOTENCY_OPERATION}#${idempotencyKey}`;
}

export interface BuildRecordInput {
  donorSub: string;
  idempotencyKey: string;
  /** JSON completo del cuerpo (incluidos campos extra); se canonicaliza para la huella. */
  payload: unknown;
  donationId: string;
  responseStatus?: number;
  now?: Date;
}

export function buildIdempotencyRecord(input: BuildRecordInput): IdempotencyRecord {
  const now = input.now ?? new Date();
  return {
    pk: buildIdempotencyPk(input.donorSub, input.idempotencyKey),
    donorSub: input.donorSub,
    operation: IDEMPOTENCY_OPERATION,
    idempotencyKey: input.idempotencyKey,
    payloadHash: payloadHash(input.payload),
    donationId: input.donationId,
    responseStatus: input.responseStatus ?? 201,
    createdAt: now.toISOString(),
    expiresAt: Math.floor(now.getTime() / 1000) + IDEMPOTENCY_TTL_SECONDS,
  };
}

/** Item `Put` condicionado a que la clave no exista, listo para `TransactWriteItems`. */
export function idempotencyPutItem(tableName: string, record: IdempotencyRecord): TransactItem {
  return {
    Put: {
      TableName: tableName,
      Item: record,
      ConditionExpression: "attribute_not_exists(pk)",
    },
  };
}

export type IdempotencyDecision =
  | { kind: "absent" }
  | { kind: "replay"; donationId: string; responseStatus: number }
  | { kind: "conflict" };

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Decide qué hacer cuando la reserva ya existe (tras cancelarse la transacción):
 * - sin registro: la cancelación tuvo otra causa (p. ej. proyecto no publicado);
 * - misma huella: devolver el resultado almacenado sin crear otra donación;
 * - huella distinta: 409.
 */
export function decideIdempotency(
  existing: Pick<IdempotencyRecord, "payloadHash" | "donationId" | "responseStatus"> | undefined,
  payload: unknown,
): IdempotencyDecision {
  if (!existing) return { kind: "absent" };
  if (sameHash(existing.payloadHash, payloadHash(payload))) {
    return {
      kind: "replay",
      donationId: existing.donationId,
      responseStatus: existing.responseStatus,
    };
  }
  return { kind: "conflict" };
}

/**
 * Lee `Idempotency-Key` de las cabeceras (sin distinguir mayúsculas en el nombre). Ausente → 400
 * MISSING_IDEMPOTENCY_KEY; con formato distinto de UUID → 400. Se normaliza a minúsculas para que
 * el mismo UUID en mayúsculas o minúsculas sea la misma clave. Solo se admite la cabecera: la clave
 * enviada en el cuerpo o la query se ignora.
 */
export function readIdempotencyKey(
  headers: Record<string, string | undefined> | null | undefined,
): string {
  let raw: string | undefined;
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() === "idempotency-key") raw = value;
  }
  if (raw === undefined || raw === "") throw badRequest("MISSING_IDEMPOTENCY_KEY", "sin clave");
  if (!idempotencyKeySchema.safeParse(raw).success) {
    throw badRequest("INVALID_REQUEST", "clave con formato inválido");
  }
  return raw.toLowerCase();
}
