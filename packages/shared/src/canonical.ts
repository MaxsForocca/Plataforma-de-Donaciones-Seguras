/**
 * Serialización JSON canónica y huella SHA-256 (T014), base de la idempotencia (constitución,
 * principio IV, y clarificación 2026-11-09).
 *
 * Reglas: claves ordenadas por unidades de código UTF-16, sin espacios insignificantes, el orden
 * de los arreglos se conserva y cualquier campo extra o valor distinto cambia el resultado.
 * Solo se admiten valores JSON (objetos planos, arreglos, string, number finito, boolean, null);
 * cualquier otro valor lanza `TypeError` en lugar de producir una huella ambigua.
 *
 * Nota: usa `node:crypto`; solo debe importarse desde el backend, nunca desde la SPA.
 */
import { createHash } from "node:crypto";

const MAX_DEPTH = 64;

function serialize(value: unknown, depth: number): string {
  if (depth > MAX_DEPTH) {
    throw new RangeError("Estructura demasiado profunda o cíclica para canonicalizar");
  }
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError("Los números no finitos (NaN, Infinity) no son JSON válido");
      }
      return JSON.stringify(value); // -0 se serializa como "0"
    case "object":
      break;
    default:
      throw new TypeError(`Tipo no serializable en JSON canónico: ${typeof value}`);
  }

  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      parts.push(serialize(value[index], depth + 1)); // un hueco (undefined) lanza TypeError
    }
    return `[${parts.join(",")}]`;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Solo se admiten objetos planos en JSON canónico");
  }

  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serialize(record[key], depth + 1)}`);
  return `{${parts.join(",")}}`;
}

/** Devuelve la representación JSON canónica de `value`. */
export function canonicalize(value: unknown): string {
  return serialize(value, 0);
}

/** SHA-256 hexadecimal (64 caracteres) de un texto UTF-8. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Huella de la carga: SHA-256 del JSON canónico completo (incluye campos extra). */
export function payloadHash(value: unknown): string {
  return sha256Hex(canonicalize(value));
}
