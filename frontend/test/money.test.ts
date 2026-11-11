import { describe, expect, it } from "vitest";
import { formatPen } from "../src/services/money";

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
