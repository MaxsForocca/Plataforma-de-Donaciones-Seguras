import { describe, expect, it } from "vitest";
import { formatPen, percentOf } from "../src/services/money";

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
