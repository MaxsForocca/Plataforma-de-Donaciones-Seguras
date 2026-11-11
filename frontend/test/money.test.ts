import { describe, expect, it } from "vitest";
import { formatPen, parsePenToCents, percentOf } from "../src/services/money";

describe("formatPen (principio III: sin aritmética de punto flotante)", () => {
  it.each([
    [0, "S/ 0.00"],
    [1, "S/ 0.01"],
    [9, "S/ 0.09"],
    [10, "S/ 0.10"],
    [99, "S/ 0.99"],
    [100, "S/ 1.00"],
    [101, "S/ 1.01"],
    [1050, "S/ 10.50"],
    [99_999, "S/ 999.99"],
    [100_000, "S/ 1,000.00"],
    [123_456_789, "S/ 1,234,567.89"],
    [100_000_000_000, "S/ 1,000,000,000.00"],
  ])("%i céntimos → %s", (cents, expected) => {
    expect(formatPen(cents)).toBe(expected);
  });

  it("formatea los límites de una donación (S/ 1.00 y S/ 1,000.00)", () => {
    expect(formatPen(100)).toBe("S/ 1.00");
    expect(formatPen(100_000)).toBe("S/ 1,000.00");
  });

  it("es exacto en el mayor entero seguro (un float perdería precisión)", () => {
    expect(formatPen(Number.MAX_SAFE_INTEGER)).toBe("S/ 90,071,992,547,409.91");
  });

  it("no sufre los errores de redondeo clásicos del punto flotante (0.1 + 0.2, 1.005)", () => {
    expect(formatPen(30)).toBe("S/ 0.30");
    expect(formatPen(101)).toBe("S/ 1.01");
    expect(formatPen(115)).toBe("S/ 1.15");
  });

  it("agrupa miles solo en la parte entera", () => {
    expect(formatPen(1_000_000)).toBe("S/ 10,000.00");
    expect(formatPen(100_050)).toBe("S/ 1,000.50");
  });

  it("formatea negativos con signo (p. ej. diferencias)", () => {
    expect(formatPen(-1)).toBe("-S/ 0.01");
    expect(formatPen(-123_456)).toBe("-S/ 1,234.56");
  });

  it("trata -0 como cero", () => {
    expect(formatPen(-0)).toBe("S/ 0.00");
  });

  describe("rechaza valores que no son céntimos enteros", () => {
    it.each([
      ["decimal", 10.5],
      ["decimal pequeño", 0.1],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
      ["entero no seguro", 2 ** 53],
      ["exponente enorme", 1e21],
      ["string numérico", "100"],
      ["null", null],
      ["undefined", undefined],
      ["bigint", 100n],
      ["objeto", {}],
    ])("%s", (_label, value) => {
      expect(() => formatPen(value as number)).toThrow(RangeError);
    });
  });
});

describe("percentOf (avance sin punto flotante)", () => {
  it.each([
    [0, 100, 0],
    [1, 100, 1],
    [50, 100, 50],
    [99, 100, 99],
    [100, 100, 100],
    [150, 100, 100],
    [1, 3, 33],
    [2, 3, 66],
    [10_000, 500_000, 2],
    [499_999, 500_000, 99],
    [Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER, 99],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 100],
  ])("%i de %i → %i %%", (part, whole, expected) => {
    expect(percentOf(part, whole)).toBe(expected);
  });

  it("redondea hacia abajo: nunca muestra 100 % antes de alcanzar la meta", () => {
    expect(percentOf(99_999, 100_000)).toBe(99);
  });

  it("se limita a 100 aunque se supere la meta", () => {
    expect(percentOf(1_000_000, 1)).toBe(100);
  });

  it.each([
    ["total cero", 5, 0],
    ["total negativo", 5, -1],
    ["parte negativa", -1, 100],
    ["parte decimal", 1.5, 100],
    ["total decimal", 1, 100.5],
    ["NaN", Number.NaN, 100],
    ["Infinity", 1, Number.POSITIVE_INFINITY],
    ["entero no seguro", 2 ** 53, 100],
  ])("rechaza %s", (_label, part, whole) => {
    expect(() => percentOf(part, whole)).toThrow(RangeError);
  });
});

describe("parsePenToCents (entrada del usuario → céntimos enteros, sin punto flotante)", () => {
  it.each([
    ["0", 0],
    ["0.01", 1],
    ["0.5", 50],
    ["1", 100],
    ["1.0", 100],
    ["1.00", 100],
    ["1.5", 150],
    ["25.50", 2550],
    ["25.05", 2505],
    ["999.99", 99_999],
    ["1000", 100_000],
    ["1000.00", 100_000],
    ["1,000", 100_000],
    ["1,000.00", 100_000],
    ["12,345.67", 1_234_567],
    ["S/ 25.50", 2550],
    ["s/25.5", 2550],
    ["S/. 10", 1000],
    ["  12.5  ", 1250],
    ["100000", 10_000_000],
  ])("%j → %i céntimos", (input, expected) => {
    expect(parsePenToCents(input)).toBe(expected);
  });

  it("evita los errores clásicos del punto flotante (0.1 + 0.2, 1.005, 19.99 * 100)", () => {
    expect(parsePenToCents("0.30")).toBe(30);
    expect(parsePenToCents("19.99")).toBe(1999); // 19.99 * 100 = 1998.9999999999998 en float
    expect(parsePenToCents("1.15")).toBe(115); // 1.15 * 100 = 114.99999999999999 en float
    expect(parsePenToCents("4.35")).toBe(435); // 4.35 * 100 = 434.99999999999994 en float
  });

  it.each([
    ["vacío", ""],
    ["solo espacios", "   "],
    ["solo el símbolo", "S/"],
    ["texto", "abc"],
    ["texto con número", "12abc"],
    ["negativo", "-5"],
    ["con signo +", "+5"],
    ["coma decimal", "25,50"],
    ["más de 2 decimales", "12.345"],
    ["punto final", "5."],
    ["sin parte entera", ".5"],
    ["notación científica", "1e2"],
    ["notación científica con decimales", "1.5e2"],
    ["hexadecimal", "0x10"],
    ["ceros a la izquierda", "007.50"],
    ["agrupación de miles incorrecta", "1,00"],
    ["agrupación con 4 dígitos", "1,0000"],
    ["dos puntos", "1.2.3"],
    ["espacio interno", "1 000"],
    ["dígitos no ASCII (árabe)", "٥"],
    ["dígitos de ancho completo", "５"],
    ["infinito", "Infinity"],
    ["NaN", "NaN"],
    ["moneda distinta", "$ 5.00"],
    ["símbolo al final", "5 S/"],
  ])("rechaza %s (%j) → null", (_label, input) => {
    expect(parsePenToCents(input)).toBeNull();
  });

  it("rechaza lo que no es texto", () => {
    for (const value of [null, undefined, 25, 25.5, {}, [], true]) {
      expect(parsePenToCents(value as never)).toBeNull();
    }
  });

  it("rechaza importes que no caben en un entero seguro (no pierde precisión)", () => {
    expect(parsePenToCents("90071992547409.92")).toBeNull();
    expect(parsePenToCents("999999999999999999999")).toBeNull();
    expect(parsePenToCents("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("es el inverso de formatPen para importes válidos", () => {
    for (const cents of [100, 101, 1050, 99_999, 100_000]) {
      expect(parsePenToCents(formatPen(cents))).toBe(cents);
    }
  });
});
