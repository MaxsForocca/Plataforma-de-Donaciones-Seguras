/**
 * Formato de importes (T033). El dinero siempre viaja y se calcula como entero de céntimos de PEN
 * (constitución, principio III); aquí solo se presenta. No hay aritmética de punto flotante: la
 * división y el resto se hacen con BigInt y la agrupación de miles con texto.
 */
/** `1050` → `"S/ 10.50"`; `100000` → `"S/ 1,000.00"`. Lanza `RangeError` si no es un entero seguro. */
export declare function formatPen(cents: number): string;
