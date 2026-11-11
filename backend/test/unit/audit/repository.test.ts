import { describe, expect, it } from "vitest";
import {
  actorRef,
  AUDIT_EVENT_TYPES,
  auditPutItem,
  buildAuditEvent,
  sanitizeMetadata,
  writeAuditEvent,
  type AuditEventInput,
} from "../../../src/audit/repository";
import { DONOR_A_SUB, DONOR_B_SUB, PUBLISHED_PROJECT_ID } from "../../helpers/fixtures";
import { createRecordingClient } from "../../helpers/setup";

const NOW = new Date("2026-11-11T12:00:00.000Z");
const EVENT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const deps = { now: () => NOW, newId: () => EVENT_ID };

const input = (overrides: Partial<AuditEventInput> = {}): AuditEventInput => ({
  eventType: "PROJECT_CREATED",
  requestId: "req-1",
  actorSub: DONOR_A_SUB,
  action: "createProject",
  resourceRef: PUBLISHED_PROJECT_ID,
  outcome: "SUCCESS",
  ...overrides,
});

describe("buildAuditEvent", () => {
  it("construye el evento con clave de ordenación timestamp#eventId", () => {
    expect(buildAuditEvent(input(), deps)).toEqual({
      eventType: "PROJECT_CREATED",
      sk: `2026-11-11T12:00:00.000Z#${EVENT_ID}`,
      timestamp: "2026-11-11T12:00:00.000Z",
      eventId: EVENT_ID,
      requestId: "req-1",
      actorRef: actorRef(DONOR_A_SUB),
      action: "createProject",
      resourceRef: PUBLISHED_PROJECT_ID,
      outcome: "SUCCESS",
    });
  });

  it.each(AUDIT_EVENT_TYPES)("acepta el tipo %s", (eventType) => {
    expect(buildAuditEvent(input({ eventType }), deps).eventType).toBe(eventType);
  });

  it("registra un rechazo (ACCESS_DENIED / DENIED)", () => {
    const event = buildAuditEvent(input({ eventType: "ACCESS_DENIED", outcome: "DENIED" }), deps);
    expect(event).toMatchObject({ eventType: "ACCESS_DENIED", outcome: "DENIED" });
  });

  it("dos eventos en el mismo instante tienen distinta clave de ordenación", () => {
    const a = buildAuditEvent(input(), { now: () => NOW });
    const b = buildAuditEvent(input(), { now: () => NOW });
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.sk).not.toBe(b.sk);
  });

  describe("validación de entradas", () => {
    it.each([
      ["tipo desconocido", { eventType: "OTRO" as never }],
      ["resultado inválido", { outcome: "OK" as never }],
      ["requestId vacío", { requestId: "" }],
      ["requestId demasiado largo", { requestId: "r".repeat(129) }],
      ["actor vacío", { actorSub: "" }],
      ["acción vacía", { action: "" }],
      ["recurso vacío", { resourceRef: "" }],
      ["recurso demasiado largo", { resourceRef: "x".repeat(129) }],
    ])("rechaza %s", (_label, overrides) => {
      expect(() => buildAuditEvent(input(overrides), deps)).toThrow(TypeError);
    });
  });

  describe("no almacena datos sensibles", () => {
    it("el actor se seudonimiza: el sub en claro no aparece en el evento", () => {
      const serialized = JSON.stringify(buildAuditEvent(input(), deps));
      expect(serialized).not.toContain(DONOR_A_SUB);
      expect(buildAuditEvent(input(), deps).actorRef).toMatch(/^actor:[0-9a-f]{16}$/);
    });

    it("no hay campos de token, clave de idempotencia ni donorSub", () => {
      const keys = Object.keys(buildAuditEvent(input({ metadata: { amountCents: 500 } }), deps));
      for (const forbidden of ["token", "idempotencyKey", "donorSub", "sub", "authorization"]) {
        expect(keys).not.toContain(forbidden);
      }
    });
  });
});

describe("actorRef", () => {
  it("es estable para el mismo sub y distinto entre usuarios", () => {
    expect(actorRef(DONOR_A_SUB)).toBe(actorRef(DONOR_A_SUB));
    expect(actorRef(DONOR_A_SUB)).not.toBe(actorRef(DONOR_B_SUB));
  });
});

describe("sanitizeMetadata", () => {
  it("devuelve undefined si no hay metadatos o quedan vacíos", () => {
    expect(sanitizeMetadata(undefined)).toBeUndefined();
    expect(sanitizeMetadata({})).toBeUndefined();
    expect(sanitizeMetadata({ token: "x" })).toBeUndefined();
  });

  it("conserva primitivos acotados", () => {
    expect(
      sanitizeMetadata({ amountCents: 500, status: "CONFIRMADA_SIMULADA", replay: false }),
    ).toEqual({ amountCents: 500, status: "CONFIRMADA_SIMULADA", replay: false });
  });

  it.each([
    "token",
    "accessToken",
    "access_token",
    "Authorization",
    "bearer",
    "cookie",
    "password",
    "clientSecret",
    "cardNumber",
    "cvv",
    "CVC",
    "dni",
    "email",
    "phone",
    "bankAccount",
    "idempotencyKey",
    "Idempotency-Key",
    "donorSub",
    "sub",
  ])("elimina la clave sensible %s", (key) => {
    expect(sanitizeMetadata({ [key]: "valor", amountCents: 100 })).toEqual({ amountCents: 100 });
  });

  it("no elimina claves legítimas que solo se parecen (p. ej. substatus no contiene 'sub' exacto)", () => {
    expect(sanitizeMetadata({ substatus: "ok", subtotalCents: 5 })).toEqual({
      substatus: "ok",
      subtotalCents: 5,
    });
  });

  it.each([
    ["objeto anidado", { a: { b: 1 } }],
    ["arreglo", { a: [1] }],
    ["null", { a: null }],
    ["undefined", { a: undefined }],
    ["NaN", { a: Number.NaN }],
    ["Infinity", { a: Number.POSITIVE_INFINITY }],
    ["función", { a: () => 1 }],
    ["bigint", { a: 1n }],
  ])("descarta valores no primitivos o no finitos (%s)", (_label, metadata) => {
    expect(sanitizeMetadata(metadata)).toBeUndefined();
  });

  it("trunca las cadenas a 200 caracteres", () => {
    expect(sanitizeMetadata({ nota: "x".repeat(500) })?.nota).toHaveLength(200);
  });

  it("limita a 10 claves", () => {
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(sanitizeMetadata(many) ?? {})).toHaveLength(10);
  });

  it("las claves sensibles no consumen el límite de 10", () => {
    const metadata: Record<string, unknown> = {};
    for (let i = 0; i < 5; i += 1) metadata[`token${i}`] = "x";
    for (let i = 0; i < 10; i += 1) metadata[`k${i}`] = i;
    expect(Object.keys(sanitizeMetadata(metadata) ?? {})).toHaveLength(10);
  });
});

describe("auditPutItem y writeAuditEvent", () => {
  const event = buildAuditEvent(input(), deps);

  it("auditPutItem es un Put condicionado a que el evento no exista", () => {
    expect(auditPutItem("tabla-audit", event)).toEqual({
      Put: {
        TableName: "tabla-audit",
        Item: event,
        ConditionExpression: "attribute_not_exists(eventType)",
      },
    });
  });

  it("writeAuditEvent envía un PutCommand a la tabla indicada", async () => {
    const client = createRecordingClient();
    await writeAuditEvent(client, "tabla-audit", event);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.name).toBe("PutCommand");
    expect(client.calls[0]?.input).toMatchObject({
      TableName: "tabla-audit",
      Item: event,
      ConditionExpression: "attribute_not_exists(eventType)",
    });
  });

  it("propaga el error de la base de datos (el llamador decide cómo tratarlo)", async () => {
    const client = createRecordingClient(() => new Error("fallo de DynamoDB"));
    await expect(writeAuditEvent(client, "tabla-audit", event)).rejects.toThrow(
      "fallo de DynamoDB",
    );
  });
});
