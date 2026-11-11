/**
 * Esquemas Zod, constantes y tipos de dominio compartidos por frontend y backend (T013).
 *
 * Constitución, principio III: todo importe es un entero de céntimos de PEN; nunca float.
 * `z.int()` solo acepta enteros seguros (rechaza decimales, NaN, ±Infinity y strings numéricos).
 */
import { z } from "zod";

export const CURRENCY = "PEN" as const;

/** S/ 1.00 */
export const AMOUNT_MIN_CENTS = 100;
/** S/ 1,000.00 */
export const AMOUNT_MAX_CENTS = 100_000;
export const TITLE_MAX_LENGTH = 120;
export const DESCRIPTION_MAX_LENGTH = 2000;

export const ROLES = ["DONANTE", "GESTOR", "AUDITOR"] as const;
export const PROJECT_STATUSES = ["BORRADOR", "PUBLICADO"] as const;
export const DONATION_STATUSES = [
  "PENDIENTE_SIMULACION",
  "CONFIRMADA_SIMULADA",
  "RECHAZADA_SIMULADA",
] as const;
/** Resultados que el donante puede elegir al simular (estados terminales). */
export const DONATION_OUTCOMES = ["CONFIRMADA_SIMULADA", "RECHAZADA_SIMULADA"] as const;

export const ERROR_CODES = [
  "INVALID_REQUEST",
  "INVALID_AMOUNT",
  "MISSING_IDEMPOTENCY_KEY",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR",
] as const;

// --- Primitivos -------------------------------------------------------------------------------

export const uuidSchema = z.uuid();
export const currencySchema = z.literal(CURRENCY);
export const isoDateTimeSchema = z.iso.datetime();

/** Importe de una donación: entero entre 100 y 100000 céntimos. */
export const amountCentsSchema = z.int().min(AMOUNT_MIN_CENTS).max(AMOUNT_MAX_CENTS);
/** Meta de un proyecto: entero positivo. */
export const goalAmountCentsSchema = z.int().positive();
/** Acumulado confirmado: entero no negativo (solo lo modifica el backend). */
export const confirmedAmountCentsSchema = z.int().nonnegative();

export const roleSchema = z.enum(ROLES);
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export const donationStatusSchema = z.enum(DONATION_STATUSES);
export const donationOutcomeSchema = z.enum(DONATION_OUTCOMES);

/** Texto libre sin HTML (`<` y `>` no se admiten), recortado y con longitud acotada. */
const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/[<>]/.test(value), { message: "No se admite HTML" });

export const titleSchema = plainText(TITLE_MAX_LENGTH);
export const descriptionSchema = plainText(DESCRIPTION_MAX_LENGTH);

// --- Entidades de respuesta -------------------------------------------------------------------

export const projectSummarySchema = z.strictObject({
  projectId: uuidSchema,
  title: titleSchema,
  description: descriptionSchema,
  goalAmountCents: goalAmountCentsSchema,
  confirmedAmountCents: confirmedAmountCentsSchema,
  currency: currencySchema,
});

export const projectSchema = projectSummarySchema.extend({
  status: projectStatusSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const projectStatsSchema = z.strictObject({
  projectId: uuidSchema,
  goalAmountCents: goalAmountCentsSchema,
  confirmedAmountCents: confirmedAmountCentsSchema,
  currency: currencySchema,
});

/** Representación pública de una donación: nunca incluye `donorSub`. */
export const donationSchema = z.strictObject({
  donationId: uuidSchema,
  projectId: uuidSchema,
  amountCents: amountCentsSchema,
  currency: currencySchema,
  status: donationStatusSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

// --- Solicitudes ------------------------------------------------------------------------------

/** Alta de proyecto. Estricto: el cliente no puede fijar estado, acumulado ni propietario. */
export const projectCreateRequestSchema = z.strictObject({
  title: titleSchema,
  description: descriptionSchema,
  goalAmountCents: goalAmountCentsSchema,
});

/**
 * Intención de donación. Admite campos adicionales porque forman parte de la huella de idempotencia
 * (JSON completo canónico), pero el backend solo usa `projectId` y `amountCents`; `donorSub` y
 * cualquier otro campo del cliente jamás se usan como identidad ni autorización.
 */
export const donationCreateRequestSchema = z.looseObject({
  projectId: uuidSchema,
  amountCents: amountCentsSchema,
});

export const donationSimulateRequestSchema = z.strictObject({
  outcome: donationOutcomeSchema,
});

/** Cabecera `Idempotency-Key`. */
export const idempotencyKeySchema = uuidSchema;

// --- Errores ----------------------------------------------------------------------------------

/** Sobre de error uniforme: sin detalles internos ni datos de otros usuarios. */
export const errorEnvelopeSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().min(1),
});

// --- Tipos ------------------------------------------------------------------------------------

export type Role = z.infer<typeof roleSchema>;
export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type DonationStatus = z.infer<typeof donationStatusSchema>;
export type DonationOutcome = z.infer<typeof donationOutcomeSchema>;
export type ErrorCode = (typeof ERROR_CODES)[number];
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectStats = z.infer<typeof projectStatsSchema>;
export type Donation = z.infer<typeof donationSchema>;
export type ProjectCreateRequest = z.infer<typeof projectCreateRequestSchema>;
export type DonationCreateRequest = z.infer<typeof donationCreateRequestSchema>;
export type DonationSimulateRequest = z.infer<typeof donationSimulateRequestSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
