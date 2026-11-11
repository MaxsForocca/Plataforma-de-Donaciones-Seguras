/**
 * UUID v4 criptográficamente aleatorio (para `Idempotency-Key`). Usa `crypto.randomUUID` y, si no
 * existe, `crypto.getRandomValues`; si no hay ninguna fuente criptográfica FALLA en voz alta en lugar
 * de caer en `Math.random`, que sería predecible.
 */
export function generateUuid(): string {
  const source = globalThis.crypto as Crypto | undefined;
  if (typeof source?.randomUUID === "function") return source.randomUUID();
  if (typeof source?.getRandomValues !== "function") {
    throw new Error("No hay una fuente criptográfica disponible para generar el identificador");
  }

  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // versión 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variante RFC 4122
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
