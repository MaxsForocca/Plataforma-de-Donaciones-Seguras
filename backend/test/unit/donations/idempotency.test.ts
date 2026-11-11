/**
 * T069 — Idempotencia en el flujo de donaciones: la huella se calcula sobre el JSON COMPLETO canónico
 * (estable ante el orden de claves y los espacios; cambia con campos extra o valores distintos),
 * `Idempotency-Key` es obligatoria y con formato UUID, y las claves están aisladas por donante.
 *
 * Los primitivos (canonicalize, payloadHash, buildIdempotencyRecord, decideIdempotency) ya tienen
 * pruebas propias en packages/shared/test/canonical.test.ts y backend/test/unit/shared/idempotency.test.ts;
 * aquí NO se repiten: se verifica que el flujo real los usa sobre el cuerpo completo.
 */
import { payloadHash } from "@donaciones/shared/canonical";
import { describe, expect, it } from "vitest";
import { IDEMPOTENCY_TTL_SECONDS } from "../../../src/shared/idempotency";
import {
  DONOR_A_SUB,
  DONOR_B_SUB,
  PUBLISHED_PROJECT,
  PUBLISHED_PROJECT_ID,
} from "../../helpers/fixtures";
import { donationEvent, makeMemoryWorld, DEFAULT_KEY } from "../../helpers/world";

const pid = PUBLISHED_PROJECT_ID;
const world = () => makeMemoryWorld({ projects: [{ ...PUBLISHED_PROJECT }] });
const parsed = (r: { body?: string }) => JSON.parse(r.body as string);
const KEY_2 = "9b2f6c1e-5d0a-4c58-9d3e-0f1d2c3b4a59";

function storedHash(w: ReturnType<typeof world>): string {
  const tx = w.calls().find((c) => c.name === "TransactWriteCommand")!;
  return (tx.input.TransactItems as { Put: { Item: { payloadHash: string } } }[])[0]!.Put.Item
    .payloadHash;
}

describe("la huella cubre el JSON completo canónico", () => {
  const body = { projectId: pid, amountCents: 500 };

  it("el payloadHash guardado es el SHA-256 del cuerpo completo recibido", async () => {
    const w = world();
    await w.createDonation(donationEvent(body));
    expect(storedHash(w)).toBe(payloadHash(body));
  });

  it("incluye los campos extra en la huella (también los que el backend ignora)", async () => {
    const w = world();
    const extra = { ...body, donorSub: DONOR_B_SUB, nota: "hola" };
    await w.createDonation(donationEvent(extra));
    expect(storedHash(w)).toBe(payloadHash(extra));
    expect(storedHash(w)).not.toBe(payloadHash(body));
  });

  it("otro orden de claves y otros espacios producen la misma huella: la repetición es un replay", async () => {
    const w = world();
    const first = await w.createDonation(donationEvent(`{"projectId":"${pid}","amountCents":500}`));
    const second = await w.createDonation(
      donationEvent(`{\n  "amountCents" : 500 ,\t"projectId" : "${pid}"\n}`),
    );
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(parsed(second).donationId).toBe(parsed(first).donationId);
    expect(await w.dump("donations")).toHaveLength(1);
  });

  it.each([
    ["otro importe", { ...body, amountCents: 501 }],
    ["un campo extra", { ...body, extra: 1 }],
    ["un campo extra nulo", { ...body, extra: null }],
    ["un campo extra falso", { ...body, extra: false }],
    ["otro proyecto", { ...body, projectId: "00000000-0000-4000-8000-000000000009" }],
  ])("reusar la clave con %s → 409 y no se crea otra donación", async (_label, other) => {
    const w = makeMemoryWorld({
      projects: [
        { ...PUBLISHED_PROJECT },
        { ...PUBLISHED_PROJECT, projectId: "00000000-0000-4000-8000-000000000009" },
      ],
    });
    expect((await w.createDonation(donationEvent(body))).statusCode).toBe(201);
    const response = await w.createDonation(donationEvent(other));
    expect(response.statusCode).toBe(409);
    expect(parsed(response).code).toBe("CONFLICT");
    expect(await w.dump("donations")).toHaveLength(1);
  });

  it("el importe como número y como texto son cargas distintas: el texto se rechaza por validación (400), no por huella", async () => {
    const w = world();
    await w.createDonation(donationEvent(body));
    const response = await w.createDonation(donationEvent({ ...body, amountCents: "500" }));
    expect(response.statusCode).toBe(400);
  });
});

describe("registro de idempotencia", () => {
  it("clave compuesta donorSub#createDonation#key, TTL de 24 h, estado 201 y la donación creada", async () => {
    const w = world();
    const response = await w.createDonation(donationEvent({ projectId: pid, amountCents: 500 }));
    const [record] = await w.dump("idempotency");
    expect(record).toMatchObject({
      pk: `${DONOR_A_SUB}#createDonation#${DEFAULT_KEY}`,
      donorSub: DONOR_A_SUB,
      operation: "createDonation",
      idempotencyKey: DEFAULT_KEY,
      donationId: parsed(response).donationId,
      responseStatus: 201,
    });
    expect(record!.expiresAt - Math.floor(Date.parse(record!.createdAt) / 1000)).toBe(
      IDEMPOTENCY_TTL_SECONDS,
    );
  });

  it("el mismo UUID de dos donantes no colisiona: cada uno crea su propia donación", async () => {
    const w = world();
    const a = await w.createDonation(donationEvent({ projectId: pid, amountCents: 500 }));
    const b = await w.createDonation(
      donationEvent({ projectId: pid, amountCents: 500 }, { sub: DONOR_B_SUB }),
    );
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(parsed(a).donationId).not.toBe(parsed(b).donationId);
    expect(await w.dump("idempotency")).toHaveLength(2);
  });

  it("un donante no puede obtener la donación de otro reenviando su misma clave", async () => {
    const w = world();
    const a = parsed(await w.createDonation(donationEvent({ projectId: pid, amountCents: 700 })));
    const b = parsed(
      await w.createDonation(
        donationEvent({ projectId: pid, amountCents: 700 }, { sub: DONOR_B_SUB }),
      ),
    );
    expect(b.donationId).not.toBe(a.donationId);
  });

  it("claves distintas del mismo donante crean donaciones distintas", async () => {
    const w = world();
    const body = { projectId: pid, amountCents: 500 };
    await w.createDonation(donationEvent(body));
    await w.createDonation(donationEvent(body, { key: KEY_2 }));
    expect(await w.dump("donations")).toHaveLength(2);
  });
});

describe("cabecera Idempotency-Key", () => {
  const body = { projectId: pid, amountCents: 500 };

  it("ausente → 400 MISSING_IDEMPOTENCY_KEY, sin consultar la base de datos", async () => {
    const w = world();
    const response = await w.createDonation(donationEvent(body, { key: null }));
    expect(response.statusCode).toBe(400);
    expect(parsed(response).code).toBe("MISSING_IDEMPOTENCY_KEY");
    expect(w.calls()).toHaveLength(0);
  });

  it.each([
    ["vacía", ""],
    ["solo espacios", "   "],
    ["no es UUID", "clave-1"],
    ["UUID sin guiones", DEFAULT_KEY.replaceAll("-", "")],
    ["UUID con sufijo", `${DEFAULT_KEY}x`],
    ["UUID con espacio inicial", ` ${DEFAULT_KEY}`],
    ["dos UUID", `${DEFAULT_KEY}, ${KEY_2}`],
    ["con #", `${DEFAULT_KEY}#x`],
    ["'null'", "null"],
    ["demasiado larga", "a".repeat(5000)],
  ])("inválida (%s) → 400 sin consultar la base de datos", async (_label, key) => {
    const w = world();
    const response = await w.createDonation(donationEvent(body, { key }));
    expect(response.statusCode).toBe(400);
    expect(w.calls()).toHaveLength(0);
  });

  it("el nombre de la cabecera no distingue mayúsculas", async () => {
    for (const name of ["Idempotency-Key", "IDEMPOTENCY-KEY", "idempotency-key"]) {
      const w = world();
      const event = donationEvent(body, { key: null, headers: { [name]: DEFAULT_KEY } });
      expect((await w.createDonation(event)).statusCode).toBe(201);
    }
  });

  it("el UUID en mayúsculas es la MISMA clave que en minúsculas (se normaliza)", async () => {
    const w = world();
    const first = await w.createDonation(donationEvent(body, { key: DEFAULT_KEY }));
    const second = await w.createDonation(donationEvent(body, { key: DEFAULT_KEY.toUpperCase() }));
    expect(parsed(second).donationId).toBe(parsed(first).donationId);
    expect(await w.dump("donations")).toHaveLength(1);
  });

  it("una clave enviada en el cuerpo, la query o el donorSub no sustituye a la cabecera", async () => {
    const w = world();
    const response = await w.createDonation(
      donationEvent(
        { ...body, "Idempotency-Key": DEFAULT_KEY, idempotencyKey: DEFAULT_KEY },
        { key: null, query: { "Idempotency-Key": DEFAULT_KEY } },
      ),
    );
    expect(response.statusCode).toBe(400);
    expect(parsed(response).code).toBe("MISSING_IDEMPOTENCY_KEY");
  });

  it("la clave no aparece en el evento de auditoría ni en los logs de la respuesta", async () => {
    const w = world();
    const response = await w.createDonation(donationEvent(body));
    expect(JSON.stringify(await w.dump("audit"))).not.toContain(DEFAULT_KEY);
    expect(response.body).not.toContain(DEFAULT_KEY);
  });
});
