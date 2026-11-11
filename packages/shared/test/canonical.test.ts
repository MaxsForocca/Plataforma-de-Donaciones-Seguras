import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalize, payloadHash, sha256Hex } from "../src/canonical";

const ID = "00000000-0000-4000-8000-000000000001";

describe("canonicalize", () => {
  it("ordena las claves y no deja espacios", () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: [3, 1] } })).toBe('{"a":{"c":[3,1],"d":2},"b":1}');
  });

  it("es independiente del orden de claves y de los espacios del JSON de origen", () => {
    const a = JSON.parse(`{ "projectId": "${ID}", "amountCents": 500 }`);
    const b = JSON.parse(`{"amountCents":500,\n\t"projectId":"${ID}"}`);
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(payloadHash(a)).toBe(payloadHash(b));
  });

  it("ordena por unidades de código UTF-16 (mayúsculas antes que minúsculas)", () => {
    expect(canonicalize({ a: 1, B: 2, _: 3 })).toBe('{"B":2,"_":3,"a":1}');
  });

  it("conserva el orden de los arreglos", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it("distingue null de una clave ausente", () => {
    expect(canonicalize({ a: null })).not.toBe(canonicalize({}));
  });

  it.each([
    ["objeto vacío", {}, "{}"],
    ["arreglo vacío", [], "[]"],
    ["null", null, "null"],
    ["booleanos", [true, false], "[true,false]"],
    ["cadena con comillas y saltos", 'a"b\n', '"a\\"b\\n"'],
    ["unicode", { ñ: "é" }, '{"ñ":"é"}'],
    ["cero negativo", -0, "0"],
    ["100 y 100.0 son el mismo número", 100.0, "100"],
  ])("serializa %s", (_label, value, expected) => {
    expect(canonicalize(value)).toBe(expected);
  });

  it("trata una clave __proto__ propia como un dato más, sin contaminar prototipos", () => {
    const parsed = JSON.parse('{"__proto__":{"admin":true},"a":1}');
    expect(canonicalize(parsed)).toBe('{"__proto__":{"admin":true},"a":1}');
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  it("acepta objetos sin prototipo", () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.x = 1;
    expect(canonicalize(bare)).toBe('{"x":1}');
  });

  describe("valores no representables en JSON", () => {
    it.each([
      ["undefined", undefined],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
      ["bigint", 1n],
      ["función", () => 1],
      ["símbolo", Symbol("s")],
      ["Date", new Date(0)],
      ["Map", new Map()],
      ["instancia de clase", new (class Foo {})()],
      ["propiedad undefined", { a: undefined }],
      ["hueco en arreglo", [1, , 3]], // eslint-disable-line no-sparse-arrays
    ])("lanza TypeError para %s", (_label, value) => {
      expect(() => canonicalize(value)).toThrow(TypeError);
    });

    it("lanza RangeError ante una estructura cíclica", () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      expect(() => canonicalize(cyclic)).toThrow(RangeError);
    });

    it("lanza RangeError ante anidamiento excesivo", () => {
      let deep: unknown = 1;
      for (let i = 0; i < 100; i += 1) deep = [deep];
      expect(() => canonicalize(deep)).toThrow(RangeError);
    });
  });
});

describe("payloadHash (principio IV)", () => {
  it("produce SHA-256 hexadecimal de 64 caracteres", () => {
    expect(payloadHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("coincide con SHA-256 calculado de forma independiente sobre el JSON canónico", () => {
    const expected = createHash("sha256").update('{"a":1,"b":[true,null]}', "utf8").digest("hex");
    expect(payloadHash({ b: [true, null], a: 1 })).toBe(expected);
    expect(sha256Hex('{"a":1,"b":[true,null]}')).toBe(expected);
  });

  it("es determinista", () => {
    const value = { projectId: ID, amountCents: 500 };
    expect(payloadHash(value)).toBe(payloadHash({ ...value }));
  });

  it("cambia ante un valor distinto", () => {
    expect(payloadHash({ projectId: ID, amountCents: 500 })).not.toBe(
      payloadHash({ projectId: ID, amountCents: 501 }),
    );
  });

  it("cambia ante un campo extra (clarificación: JSON completo canónico)", () => {
    expect(payloadHash({ projectId: ID, amountCents: 500 })).not.toBe(
      payloadHash({ projectId: ID, amountCents: 500, note: "x" }),
    );
  });

  it("cambia aunque el campo extra sea null o falso", () => {
    const base = { projectId: ID, amountCents: 500 };
    expect(payloadHash(base)).not.toBe(payloadHash({ ...base, x: null }));
    expect(payloadHash(base)).not.toBe(payloadHash({ ...base, x: false }));
  });

  it("distingue el número 500 del texto '500'", () => {
    expect(payloadHash({ amountCents: 500 })).not.toBe(payloadHash({ amountCents: "500" }));
  });

  it("no confunde cargas que solo se parecen al concatenar claves y valores", () => {
    expect(payloadHash({ a: "b", c: "d" })).not.toBe(payloadHash({ a: 'b","c":"d' }));
  });
});
