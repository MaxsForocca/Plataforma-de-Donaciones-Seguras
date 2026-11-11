/**
 * Formato de importes (T033). El dinero siempre viaja y se calcula como entero de céntimos de PEN
 * (constitución, principio III); aquí solo se presenta. No hay aritmética de punto flotante: la
 * división y el resto se hacen con BigInt y la agrupación de miles con texto.
 */

/** `1050` → `"S/ 10.50"`; `100000` → `"S/ 1,000.00"`. Lanza `RangeError` si no es un entero seguro. */
export function formatPen(cents: number): string {
  if (typeof cents !== "number" || !Number.isSafeInteger(cents)) {
    throw new RangeError("El importe debe ser un entero seguro de céntimos");
  }
  const absolute = BigInt(Math.abs(cents));
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${cents < 0 ? "-" : ""}S/ ${whole}.${fraction}`;
}

/**
 * Porcentaje entero de `part` sobre `whole`, redondeado hacia abajo y limitado a 100. Usa BigInt: no
 * hay aritmética de punto flotante. Nunca muestra 100 % antes de alcanzar la meta.
 */
export function percentOf(part: number, whole: number): number {
  if (!Number.isSafeInteger(part) || !Number.isSafeInteger(whole) || part < 0 || whole <= 0) {
    throw new RangeError("part debe ser un entero >= 0 y whole un entero > 0");
  }
  const percent = (BigInt(part) * 100n) / BigInt(whole);
  return percent > 100n ? 100 : Number(percent);
}
