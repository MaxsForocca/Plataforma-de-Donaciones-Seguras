import { describe, expect, it } from "vitest";
import { payloadHash } from "@donaciones/shared/canonical";
import {
  buildIdempotencyPk,
  buildIdempotencyRecord,
  decideIdempotency,
  IDEMPOTENCY_OPERATION,
  IDEMPOTENCY_TTL_SECONDS,
  idempotencyPutItem,
} from "../../../src/shared/idempotency";
import {
  DONOR_A_SUB,
  DONOR_B_SUB,
  IDEMPOTENCY_KEY_1,
  IDEMPOTENCY_KEY_2,
  PENDING_DONATION_ID,
  PUBLISHED_PROJECT_ID,
} from "../../helpers/fixtures";

const payload = { projectId: PUBLISHED_PROJECT_ID, amountCents: 500 };
const NOW = new Date("2026-11-11T12:00:00.000Z");

const record = (overrides: Partial<Parameters<typeof buildIdempotencyRecord>[0]> = {}) =>
  buildIdempotencyRecord({
    donorSub: DONOR_A_SUB,
    idempotencyKey: IDEMPOTENCY_KEY_1,
    payload,
    donationId: PENDING_DONATION_ID,
    now: NOW,
    ...overrides,
  });

describe("buildIdempotencyPk", () => {
  it("usa el formato donorSub#createDonation#idempotencyKey", () => {
    expect(buildIdempotencyPk(DONOR_A_SUB, IDEMPOTENCY_KEY_1)).toBe(
      `${DONOR_A_SUB}#createDonation#${IDEMPOTENCY_KEY_1}`,
    );
  });

  it("aísla las claves por donante: el mismo UUID de dos usuarios no colisiona", () => {
    expect(buildIdempotencyPk(DONOR_A_SUB, IDEMPOTENCY_KEY_1)).not.toBe(
      buildIdempotencyPk(DONOR_B_SUB, IDEMPOTENCY_KEY_1),
    );
  });

  it("claves distintas del mismo donante producen PK distintas", () => {
    expect(buildIdempotencyPk(DONOR_A_SUB, IDEMPOTENCY_KEY_1)).not.toBe(
      buildIdempotencyPk(DONOR_A_SUB, IDEMPOTENCY_KEY_2),
    );
  });

  it.each([
    ["donorSub vacío", "", IDEMPOTENCY_KEY_1],
    ["donorSub con # (colisión de claves)", "a#createDonation#b", IDEMPOTENCY_KEY_1],
    ["clave que no es UUID", DONOR_A_SUB, "clave-1"],
    ["clave vacía", DONOR_A_SUB, ""],
    ["clave con #", DONOR_A_SUB, `${IDEMPOTENCY_KEY_1}#x`],
    ["clave con espacios", DONOR_A_SUB, ` ${IDEMPOTENCY_KEY_1}`],
    ["UUID sin guiones", DONOR_A_SUB, IDEMPOTENCY_KEY_1.replaceAll("-", "")],
  ])("rechaza %s", (_label, sub, key) => {
    expect(() => buildIdempotencyPk(sub, key)).toThrow(TypeError);
  });

  it("no permite construir la misma PK con dos pares (sub, clave) distintos", () => {
    // Un sub que contuviera '#' podría suplantar otra reserva; se rechaza antes de componerse.
    expect(() =>
      buildIdempotencyPk(`${DONOR_A_SUB}#createDonation#${IDEMPOTENCY_KEY_1}`, IDEMPOTENCY_KEY_2),
    ).toThrow();
  });
});

describe("buildIdempotencyRecord", () => {
  it("incluye exactamente los atributos del modelo de datos", () => {
    expect(Object.keys(record()).sort()).toEqual(
      [
        "pk",
        "donorSub",
        "operation",
        "idempotencyKey",
        "payloadHash",
        "donationId",
        "responseStatus",
        "createdAt",
        "expiresAt",
      ].sort(),
    );
  });

  it("guarda la huella del JSON canónico completo", () => {
    expect(record().payloadHash).toBe(payloadHash(payload));
  });

  it("la huella es la misma aunque cambie el orden de las claves", () => {
    expect(
      record({ payload: { amountCents: 500, projectId: PUBLISHED_PROJECT_ID } }).payloadHash,
    ).toBe(record().payloadHash);
  });

  it("la huella cambia con un campo extra o un valor distinto", () => {
    expect(record({ payload: { ...payload, extra: 1 } }).payloadHash).not.toBe(
      record().payloadHash,
    );
    expect(record({ payload: { ...payload, amountCents: 501 } }).payloadHash).not.toBe(
      record().payloadHash,
    );
  });

  it("no incluye donorSub en la huella (la PK ya aísla por donante)", () => {
    expect(record({ donorSub: DONOR_B_SUB }).payloadHash).toBe(record().payloadHash);
  });

  it("el TTL es exactamente 24 horas desde la creación, en segundos", () => {
    const { expiresAt, createdAt } = record();
    expect(IDEMPOTENCY_TTL_SECONDS).toBe(86_400);
    expect(createdAt).toBe("2026-11-11T12:00:00.000Z");
    expect(expiresAt).toBe(Math.floor(NOW.getTime() / 1000) + 86_400);
    expect(Number.isInteger(expiresAt)).toBe(true);
  });

  it("trunca los milisegundos al calcular expiresAt", () => {
    const withMillis = record({ now: new Date("2026-11-11T12:00:00.999Z") });
    expect(withMillis.expiresAt).toBe(Math.floor(NOW.getTime() / 1000) + 86_400);
  });

  it("registra la operación, la donación creada y el estado 201 por defecto", () => {
    const r = record();
    expect(r.operation).toBe(IDEMPOTENCY_OPERATION);
    expect(r.donationId).toBe(PENDING_DONATION_ID);
    expect(r.responseStatus).toBe(201);
    expect(record({ responseStatus: 200 }).responseStatus).toBe(200);
  });

  it("rechaza cargas no serializables como JSON (no genera una huella ambigua)", () => {
    expect(() => record({ payload: { amountCents: Number.NaN } })).toThrow(TypeError);
    expect(() => record({ payload: { a: undefined } })).toThrow(TypeError);
  });

  it("usa la hora actual si no se inyecta", () => {
    const before = Math.floor(Date.now() / 1000);
    const r = buildIdempotencyRecord({
      donorSub: DONOR_A_SUB,
      idempotencyKey: IDEMPOTENCY_KEY_1,
      payload,
      donationId: PENDING_DONATION_ID,
    });
    expect(r.expiresAt).toBeGreaterThanOrEqual(before + 86_400);
    expect(r.expiresAt).toBeLessThanOrEqual(before + 86_400 + 5);
  });
});

describe("idempotencyPutItem", () => {
  it("es un Put condicionado a attribute_not_exists(pk) en la tabla indicada", () => {
    const r = record();
    expect(idempotencyPutItem("tabla-idem", r)).toEqual({
      Put: {
        TableName: "tabla-idem",
        Item: r,
        ConditionExpression: "attribute_not_exists(pk)",
      },
    });
  });
});

describe("decideIdempotency (CA-05.4)", () => {
  const stored = () => {
    const { payloadHash: hash, donationId, responseStatus } = record();
    return { payloadHash: hash, donationId, responseStatus };
  };

  it("sin registro previo → absent (la cancelación tuvo otra causa)", () => {
    expect(decideIdempotency(undefined, payload)).toEqual({ kind: "absent" });
  });

  it("misma clave y misma carga → replay con la donación y el estado almacenados", () => {
    expect(decideIdempotency(stored(), payload)).toEqual({
      kind: "replay",
      donationId: PENDING_DONATION_ID,
      responseStatus: 201,
    });
  });

  it("misma carga con otro orden de claves → replay", () => {
    expect(
      decideIdempotency(stored(), { amountCents: 500, projectId: PUBLISHED_PROJECT_ID }).kind,
    ).toBe("replay");
  });

  it("misma carga reenviada con otros espacios (JSON reparseado) → replay", () => {
    const reparsed = JSON.parse(`{ "projectId" : "${PUBLISHED_PROJECT_ID}",\n"amountCents":500 }`);
    expect(decideIdempotency(stored(), reparsed).kind).toBe("replay");
  });

  it.each([
    ["otro importe", { ...payload, amountCents: 501 }],
    ["otro proyecto", { ...payload, projectId: "00000000-0000-4000-8000-000000000002" }],
    ["campo extra", { ...payload, note: "x" }],
    ["campo extra nulo", { ...payload, note: null }],
    ["campo extra falso", { ...payload, flag: false }],
    ["importe como texto", { ...payload, amountCents: "500" }],
    ["falta un campo", { projectId: PUBLISHED_PROJECT_ID }],
    ["objeto vacío", {}],
    ["carga nula", null],
  ])("misma clave con carga distinta (%s) → conflict", (_label, other) => {
    expect(decideIdempotency(stored(), other)).toEqual({ kind: "conflict" });
  });

  it("un hash almacenado corrupto o de otra longitud es conflicto, no una excepción", () => {
    expect(decideIdempotency({ ...stored(), payloadHash: "abc" }, payload)).toEqual({
      kind: "conflict",
    });
    expect(decideIdempotency({ ...stored(), payloadHash: "" }, payload)).toEqual({
      kind: "conflict",
    });
  });

  it("el resultado de un replay no depende de la carga reenviada (usa lo almacenado)", () => {
    const first = decideIdempotency(stored(), payload);
    const second = decideIdempotency(stored(), {
      projectId: PUBLISHED_PROJECT_ID,
      amountCents: 500,
    });
    expect(first).toEqual(second);
  });

  it("cualquier permutación del orden de claves produce la misma decisión (replay)", () => {
    const keys = ["a", "b", "c", "d", "e", "f", "g", "projectId", "amountCents"];
    const base: Record<string, unknown> = { projectId: PUBLISHED_PROJECT_ID, amountCents: 500 };
    keys.slice(0, 7).forEach((key, index) => (base[key] = index));
    const stored2 = {
      payloadHash: payloadHash(base),
      donationId: PENDING_DONATION_ID,
      responseStatus: 201,
    };

    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let round = 0; round < 50; round += 1) {
      const shuffled = Object.entries(base).sort(() => random() - 0.5);
      expect(decideIdempotency(stored2, Object.fromEntries(shuffled)).kind).toBe("replay");
    }
  });
});
