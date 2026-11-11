/**
 * Creación de donaciones simuladas (T073; constitución, principio IV). Una sola `TransactWriteItems`
 * escribe, de forma atómica y condicionada:
 *
 *   0. `Idempotency`  Put  condición `attribute_not_exists(pk)`   (reserva de la clave)
 *   1. `Donations`    Put  condición `attribute_not_exists(donationId)`
 *   2. `Projects`     ConditionCheck `status = PUBLICADO`           (no se modifica el acumulado)
 *   3. `AuditEvents`  Put  `DONATION_CREATED`
 *
 * La idempotencia NUNCA se implementa con lectura seguida de escritura. Antes de transaccionar solo se
 * lee el proyecto (`GetItem`, ConsistentRead) para responder 404 si no existe. Si la transacción se
 * cancela se interpreta cada razón en el orden de los items:
 *
 *   - idempotencia ya reservada → se lee el registro: misma huella ⇒ replay del resultado almacenado;
 *     huella distinta ⇒ 409;
 *   - proyecto no publicado ⇒ 409 (la transacción no deja nada escrito);
 *   - `TransactionConflict` (otra transacción toca el mismo item) ⇒ se reintenta con espera; si se
 *     agota, se intenta resolver con el registro y, de no existir, 409;
 *   - cualquier otra cancelación ⇒ 500 uniforme.
 *
 * `donorSub` llega del token (nunca del cuerpo); el importe, el id y el estado los fija el servidor.
 */
import { randomUUID } from "node:crypto";
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { donationSchema, type Donation, type DonationOutcome } from "@donaciones/shared";
import { z } from "zod";
import { auditPutItem, buildAuditEvent } from "../audit/repository";
import type { AppConfig } from "../shared/config";
import { cancellationCodes, type DocClient, type TransactItem } from "../shared/dynamodb";
import { conflict, internalError, notFound } from "../shared/http";
import {
  buildIdempotencyPk,
  buildIdempotencyRecord,
  decideIdempotency,
  idempotencyPutItem,
} from "../shared/idempotency";

type Item = Record<string, unknown>;

export interface DonationsDeps {
  now?: () => Date;
  newId?: () => string;
  /** Espera entre reintentos por `TransactionConflict` (inyectable en pruebas). */
  sleep?: (milliseconds: number) => Promise<void>;
  /** Intentos máximos de la transacción ante `TransactionConflict`. */
  maxAttempts?: number;
}

export interface CreateDonationContext {
  /** `sub` verificado del donante (nunca del cuerpo). */
  donorSub: string;
  requestId: string;
  /** Cabecera `Idempotency-Key` ya validada y normalizada. */
  idempotencyKey: string;
  /** Cuerpo JSON COMPLETO recibido (incluye campos extra): es lo que se canonicaliza y se hashea. */
  payload: unknown;
  /** Los únicos campos que el backend usa del cuerpo. */
  input: { projectId: string; amountCents: number };
}

export interface CreateDonationResult {
  statusCode: number;
  donation: Donation;
  /** `true` si es la repetición de una solicitud ya procesada. */
  replayed: boolean;
}

/** Donación almacenada: la representación pública más el propietario (nunca sale de la API). */
const storedDonationSchema = donationSchema.extend({ donorSub: z.string().min(1) });

export interface SimulateDonationContext {
  /** Donación ya leída y verificada como propia por el llamador (registro crudo de la base de datos). */
  donation: Item;
  /** `sub` verificado del donante: condiciona la escritura (`donorSub = :sub`). */
  donorSub: string;
  outcome: DonationOutcome;
  requestId: string;
}

const PUBLIC_FIELDS = [
  "donationId",
  "projectId",
  "amountCents",
  "currency",
  "status",
  "createdAt",
  "updatedAt",
] as const;

function toPublicDonation(item: Item | undefined): Donation {
  const picked: Item = {};
  for (const field of PUBLIC_FIELDS) if (item && field in item) picked[field] = item[field];
  const result = donationSchema.safeParse(picked);
  if (!result.success) throw internalError("donación almacenada inválida");
  return result.data;
}

export function createDonationsRepository(
  client: DocClient,
  tables: AppConfig["tables"],
  deps: DonationsDeps = {},
) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;
  const maxAttempts = deps.maxAttempts ?? 5;
  const sleep =
    deps.sleep ??
    ((milliseconds: number) => new Promise<void>((done) => setTimeout(done, milliseconds)));

  /** Lee el registro de idempotencia y decide: replay (con la donación almacenada) o 409. */
  async function resolveExisting(context: CreateDonationContext): Promise<CreateDonationResult> {
    const pk = buildIdempotencyPk(context.donorSub, context.idempotencyKey);
    const read = await client.send(
      new GetCommand({ TableName: tables.idempotency, Key: { pk }, ConsistentRead: true }),
    );
    const stored = read.Item as Item | undefined;
    if (
      stored &&
      (typeof stored.payloadHash !== "string" ||
        typeof stored.donationId !== "string" ||
        typeof stored.responseStatus !== "number")
    ) {
      throw internalError("registro de idempotencia inválido");
    }

    const decision = decideIdempotency(
      stored as { payloadHash: string; donationId: string; responseStatus: number } | undefined,
      context.payload,
    );
    if (decision.kind !== "replay") throw conflict("clave de idempotencia en conflicto");

    const donation = await client.send(
      new GetCommand({
        TableName: tables.donations,
        Key: { donationId: decision.donationId },
        ConsistentRead: true,
      }),
    );
    return {
      statusCode: decision.responseStatus,
      donation: toPublicDonation(donation.Item as Item | undefined),
      replayed: true,
    };
  }

  return {
    /**
     * Consulta las donaciones propias del donante (`donorSub`) ordenadas de más reciente a más antigua (T099).
     * Utiliza el GSI `donorSub-createdAt`. Devuelve solo los atributos públicos (nunca `donorSub`).
     */
    async listByDonor(donorSub: string): Promise<Donation[]> {
      try {
        const output = await client.send(
          new QueryCommand({
            TableName: tables.donations,
            IndexName: "donorSub-createdAt",
            KeyConditionExpression: "#donorSub = :sub",
            ExpressionAttributeNames: { "#donorSub": "donorSub" },
            ExpressionAttributeValues: { ":sub": donorSub },
            ScanIndexForward: false,
          }),
        );
        const items = (output.Items ?? []) as Item[];
        return items.map(toPublicDonation);
      } catch (error) {
        throw internalError(error instanceof Error ? error.name : "consulta de historial fallida");
      }
    },

    /**
     * Consulta una donación por su identificador asegurando que pertenezca al `donorSub` indicado (T099).
     * Si no existe o pertenece a otro donante devuelve `undefined` (aislamiento BOLA, CA-07.2).
     */
    async getById(donationId: string, donorSub: string): Promise<Donation | undefined> {
      try {
        const read = await client.send(
          new GetCommand({
            TableName: tables.donations,
            Key: { donationId },
            ConsistentRead: true,
          }),
        );
        const item = read.Item as Item | undefined;
        if (!item || item.donorSub !== donorSub) return undefined;
        return toPublicDonation(item);
      } catch (error) {
        throw internalError(error instanceof Error ? error.name : "lectura de la donación fallida");
      }
    },

    /**
     * Lee el registro crudo de una donación (`GetItem`, ConsistentRead) o `undefined`. El llamador debe
     * verificar la propiedad ANTES de usar nada de él: aquí no se valida para no distinguir un registro
     * ajeno corrupto (500) de uno inexistente (404).
     */
    async getDonation(donationId: string): Promise<Item | undefined> {
      try {
        const read = await client.send(
          new GetCommand({
            TableName: tables.donations,
            Key: { donationId },
            ConsistentRead: true,
          }),
        );
        return read.Item as Item | undefined;
      } catch (error) {
        throw internalError(error instanceof Error ? error.name : "lectura de la donación fallida");
      }
    },

    /**
     * Simulación académica (T084): PENDIENTE_SIMULACION → CONFIRMADA_SIMULADA | RECHAZADA_SIMULADA en UNA
     * `TransactWriteItems`:
     *   0. `Donations` Update condicionado a `status = PENDIENTE_SIMULACION AND donorSub = :sub`;
     *   1. (solo confirmar) `Projects` Update `ADD confirmedAmountCents :amount` (importe ALMACENADO);
     *   2. `AuditEvents` Put.
     * Solo la primera transición válida modifica el acumulado: las repeticiones, las carreras y los estados
     * terminales fallan la condición (409) sin escribir nada. `TransactionConflict` se reintenta.
     */
    async simulateDonation(context: SimulateDonationContext): Promise<Donation> {
      const parsed = storedDonationSchema.safeParse(
        Object.fromEntries(
          [...PUBLIC_FIELDS, "donorSub"]
            .filter((f) => f in context.donation)
            .map((f) => [f, context.donation[f]]),
        ),
      );
      if (!parsed.success) throw internalError("donación almacenada inválida");
      const stored = parsed.data;
      if (stored.status !== "PENDIENTE_SIMULACION")
        throw conflict("la donación ya está en estado terminal");

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const instant = now();
        const timestamp = instant.toISOString();
        const confirm = context.outcome === "CONFIRMADA_SIMULADA";
        const audit = buildAuditEvent(
          {
            eventType: confirm ? "DONATION_CONFIRMED" : "DONATION_REJECTED",
            requestId: context.requestId,
            actorSub: context.donorSub,
            action: "simulateDonation",
            resourceRef: stored.donationId,
            outcome: "SUCCESS",
            metadata: { amountCents: stored.amountCents, projectId: stored.projectId },
          },
          { now: () => instant },
        );

        const items: TransactItem[] = [
          {
            Update: {
              TableName: tables.donations,
              Key: { donationId: stored.donationId },
              UpdateExpression: "SET #status = :next, updatedAt = :now",
              ConditionExpression: "#status = :pending AND donorSub = :sub",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":next": context.outcome,
                ":pending": "PENDIENTE_SIMULACION",
                ":sub": context.donorSub,
                ":now": timestamp,
              },
            },
          },
          ...(confirm
            ? [
                {
                  Update: {
                    TableName: tables.projects,
                    Key: { projectId: stored.projectId },
                    UpdateExpression: "ADD confirmedAmountCents :amount",
                    ConditionExpression: "attribute_exists(projectId)",
                    ExpressionAttributeValues: { ":amount": stored.amountCents },
                  },
                } satisfies TransactItem,
              ]
            : []),
          auditPutItem(tables.audit, audit),
        ];

        try {
          await client.send(new TransactWriteCommand({ TransactItems: items }));
          const { donorSub: _owner, ...publicFields } = stored;
          void _owner;
          return donationSchema.parse({
            ...publicFields,
            status: context.outcome,
            updatedAt: timestamp,
          });
        } catch (error) {
          const codes = cancellationCodes(error);
          if (codes.length === 0) {
            throw internalError(error instanceof Error ? error.name : "transacción fallida");
          }
          // Estado ya cambiado (repetición, carrera) o no es del donante: 409 sin efectos.
          if (codes[0] === "ConditionalCheckFailed")
            throw conflict("la donación ya no está pendiente");
          if (codes.includes("TransactionConflict")) {
            if (attempt < maxAttempts) {
              await sleep(20 * attempt + Math.floor(Math.random() * 20));
              continue;
            }
            throw conflict("conflicto de transacción");
          }
          throw internalError(`cancelación inesperada: ${codes.join(",")}`);
        }
      }
      throw conflict("conflicto de transacción");
    },

    async createDonation(context: CreateDonationContext): Promise<CreateDonationResult> {
      // 404 antes de transaccionar: el proyecto debe existir (el 409 por estado lo decide la transacción).
      let project: Item | undefined;
      try {
        const read = await client.send(
          new GetCommand({
            TableName: tables.projects,
            Key: { projectId: context.input.projectId },
            ConsistentRead: true,
            ProjectionExpression: "projectId",
          }),
        );
        project = read.Item as Item | undefined;
      } catch (error) {
        throw internalError(error instanceof Error ? error.name : "lectura del proyecto fallida");
      }
      if (!project) throw notFound("proyecto inexistente");

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const instant = now();
        const timestamp = instant.toISOString();
        const donationId = newId();

        const donation = {
          donationId,
          projectId: context.input.projectId,
          donorSub: context.donorSub,
          amountCents: context.input.amountCents,
          currency: "PEN",
          status: "PENDIENTE_SIMULACION",
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const record = buildIdempotencyRecord({
          donorSub: context.donorSub,
          idempotencyKey: context.idempotencyKey,
          payload: context.payload,
          donationId,
          responseStatus: 201,
          now: instant,
        });
        const audit = buildAuditEvent(
          {
            eventType: "DONATION_CREATED",
            requestId: context.requestId,
            actorSub: context.donorSub,
            action: "createDonation",
            resourceRef: donationId,
            outcome: "SUCCESS",
            metadata: {
              amountCents: context.input.amountCents,
              projectId: context.input.projectId,
            },
          },
          { now: () => instant },
        );

        const items: TransactItem[] = [
          idempotencyPutItem(tables.idempotency, record),
          {
            Put: {
              TableName: tables.donations,
              Item: donation,
              ConditionExpression: "attribute_not_exists(donationId)",
            },
          },
          {
            ConditionCheck: {
              TableName: tables.projects,
              Key: { projectId: context.input.projectId },
              ConditionExpression: "#status = :published",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: { ":published": "PUBLICADO" },
            },
          },
          auditPutItem(tables.audit, audit),
        ];

        try {
          await client.send(new TransactWriteCommand({ TransactItems: items }));
          return { statusCode: 201, donation: toPublicDonation(donation), replayed: false };
        } catch (error) {
          const codes = cancellationCodes(error);
          if (codes.length === 0) {
            throw internalError(error instanceof Error ? error.name : "transacción fallida");
          }
          // La clave ya estaba reservada: replay (misma huella) o conflicto (huella distinta).
          if (codes[0] === "ConditionalCheckFailed") return await resolveExisting(context);
          // Otra transacción toca el mismo item: reintento con espera y, si se agota, resolver.
          if (codes.includes("TransactionConflict")) {
            if (attempt < maxAttempts) {
              await sleep(20 * attempt + Math.floor(Math.random() * 20));
              continue;
            }
            return await resolveExisting(context);
          }
          if (codes[2] === "ConditionalCheckFailed") throw conflict("proyecto no publicado");
          throw internalError(`cancelación inesperada: ${codes.join(",")}`);
        }
      }
      return await resolveExisting(context);
    },
  };
}

export type DonationsRepository = ReturnType<typeof createDonationsRepository>;
