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

const AMOUNT_PATTERN = /^(?:S\/\.?\s*)?(0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d{1,2}))?$/i;

/**
 * Convierte el texto que escribe el usuario (`"25.50"`, `"S/ 25.5"`, `"1,000.00"`) en céntimos enteros,
 * con aritmética de texto/BigInt: jamás pasa por `parseFloat` ni multiplica un decimal (19.99 * 100
 * daría 1998.9999999999998). Devuelve `null` si el formato no es válido: coma decimal, más de 2
 * decimales, notación científica, signos, ceros a la izquierda, dígitos no ASCII o un valor que no
 * cabe en un entero seguro. No valida el rango de una donación (eso lo hace el formulario).
 */
export function parsePenToCents(input: string): number | null {
  if (typeof input !== "string") return null;
  const match = AMOUNT_PATTERN.exec(input.trim());
  if (!match) return null;
  const whole = (match[1] ?? "").replaceAll(",", "");
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const cents = BigInt(whole) * 100n + BigInt(fraction);
  return cents > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(cents);
}
