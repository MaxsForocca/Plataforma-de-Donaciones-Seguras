/**
 * T072 — Creación de donaciones de punta a punta: replay idempotente, 409 por carga distinta,
 * 409 por proyecto no publicado, sin escrituras parciales y concurrencia (CA-05.1–CA-05.5,
 * constitución IV). Los MISMOS escenarios corren contra el doble en memoria (siempre) y contra
 * DynamoDB Local (si DYNAMODB_LOCAL_ENDPOINT está definido), donde la atomicidad es real.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { actorRef } from "../../src/audit/repository";
import {
  DONOR_A_SUB,
  DONOR_B_SUB,
  DRAFT_PROJECT,
  DRAFT_PROJECT_ID,
  MANAGER_SUB,
  MISSING_PROJECT_ID,
  PUBLISHED_PROJECT,
  PUBLISHED_PROJECT_ID,
} from "../helpers/fixtures";
import { auditorEvent, gestorEvent, hasLocalDynamo } from "../helpers/setup";
import {
  DEFAULT_KEY,
  donationEvent,
  makeLocalWorld,
  makeMemoryWorld,
  type World,
} from "../helpers/world";

const pid = PUBLISHED_PROJECT_ID;
const valid = { projectId: pid, amountCents: 2500 };
const seed = () => ({ projects: [{ ...PUBLISHED_PROJECT }, { ...DRAFT_PROJECT }] });
const body = (r: { body?: string }) => JSON.parse(r.body as string);
const keyFor = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

function scenarios(getWorld: () => Promise<World>) {
  let world: World;
  beforeAll(async () => {
    world = await getWorld();
  });
  const count = async (table: "donations" | "idempotency" | "audit") =>
    (await world.dump(table)).length;
  const donationsOf = async (key: string) =>
    (await world.dump("idempotency")).filter((r) => r.idempotencyKey === key);

  it("registra la intención: 201, PENDIENTE_SIMULACION, registro de idempotencia y auditoría, acumulado intacto", async () => {
    const response = await world.createDonation(donationEvent(valid, { key: keyFor(1) }));
    expect(response.statusCode).toBe(201);
    const donation = body(response);
    expect(donation.status).toBe("PENDIENTE_SIMULACION");

    const stored = (await world.dump("donations")).find(
      (d) => d.donationId === donation.donationId,
    )!;
    expect(stored).toMatchObject({ donorSub: DONOR_A_SUB, amountCents: 2500, currency: "PEN" });
    expect((await donationsOf(keyFor(1)))[0]).toMatchObject({
      donationId: donation.donationId,
      responseStatus: 201,
    });
    const events = (await world.dump("audit")).filter((e) => e.resourceRef === donation.donationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "DONATION_CREATED",
      actorRef: actorRef(DONOR_A_SUB),
      outcome: "SUCCESS",
    });
    const project = (await world.dump("projects")).find((p) => p.projectId === pid)!;
    expect(project.confirmedAmountCents).toBe(PUBLISHED_PROJECT.confirmedAmountCents);
  });

  it("replay: misma clave y mismo cuerpo → mismo resultado, sin otra donación, otro registro ni otro evento", async () => {
    const first = await world.createDonation(donationEvent(valid, { key: keyFor(2) }));
    const [d, i, a] = [await count("donations"), await count("idempotency"), await count("audit")];
    const second = await world.createDonation(donationEvent(valid, { key: keyFor(2) }));
    expect(second.statusCode).toBe(201);
    expect(second.body).toBe(first.body);
    expect([await count("donations"), await count("idempotency"), await count("audit")]).toEqual([
      d,
      i,
      a,
    ]);
  });

  it("replay con otro orden de claves y otros espacios", async () => {
    const first = await world.createDonation(donationEvent(valid, { key: keyFor(3) }));
    const reordered = `{\n "amountCents": 2500,\n "projectId": "${pid}"\n}`;
    const second = await world.createDonation(donationEvent(reordered, { key: keyFor(3) }));
    expect(body(second).donationId).toBe(body(first).donationId);
  });

  it.each([
    ["otro importe", { ...valid, amountCents: 2501 }],
    ["un campo extra", { ...valid, extra: true }],
  ])("misma clave con %s → 409 sin cambiar nada", async (_label, other) => {
    await world.createDonation(
      donationEvent(valid, { key: keyFor(4 + (_label === "un campo extra" ? 1 : 0)) }),
    );
    const key = keyFor(4 + (_label === "un campo extra" ? 1 : 0));
    const [d, i, a] = [await count("donations"), await count("idempotency"), await count("audit")];
    const response = await world.createDonation(donationEvent(other, { key }));
    expect(response.statusCode).toBe(409);
    expect(body(response).code).toBe("CONFLICT");
    expect([await count("donations"), await count("idempotency"), await count("audit")]).toEqual([
      d,
      i,
      a,
    ]);
  });

  it("proyecto en BORRADOR → 409 y SIN escrituras parciales (ni donación, ni clave reservada, ni evento)", async () => {
    const [d, i, a] = [await count("donations"), await count("idempotency"), await count("audit")];
    const response = await world.createDonation(
      donationEvent({ ...valid, projectId: DRAFT_PROJECT_ID }, { key: keyFor(10) }),
    );
    expect(response.statusCode).toBe(409);
    expect([await count("donations"), await count("idempotency"), await count("audit")]).toEqual([
      d,
      i,
      a,
    ]);
    expect(await donationsOf(keyFor(10))).toHaveLength(0);
  });

  it("proyecto inexistente → 404 y sin escrituras", async () => {
    const [d, i, a] = [await count("donations"), await count("idempotency"), await count("audit")];
    const response = await world.createDonation(
      donationEvent({ ...valid, projectId: MISSING_PROJECT_ID }, { key: keyFor(11) }),
    );
    expect(response.statusCode).toBe(404);
    expect([await count("donations"), await count("idempotency"), await count("audit")]).toEqual([
      d,
      i,
      a,
    ]);
  });

  it("importes y claves inválidos se rechazan sin escribir", async () => {
    const [d, i, a] = [await count("donations"), await count("idempotency"), await count("audit")];
    for (const amountCents of [0, 99, 100_001, 100.5, "500"]) {
      expect(
        (await world.createDonation(donationEvent({ ...valid, amountCents }, { key: keyFor(12) })))
          .statusCode,
      ).toBe(400);
    }
    expect((await world.createDonation(donationEvent(valid, { key: null }))).statusCode).toBe(400);
    expect([await count("donations"), await count("idempotency"), await count("audit")]).toEqual([
      d,
      i,
      a,
    ]);
  });

  it("10 solicitudes concurrentes con la MISMA clave y la misma carga: todas 201 con la misma donación, una sola creada", async () => {
    const before = await count("donations");
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        world.createDonation(donationEvent(valid, { key: keyFor(20) })),
      ),
    );
    expect(responses.map((r) => r.statusCode)).toEqual(Array(10).fill(201));
    expect(new Set(responses.map((r) => body(r).donationId)).size).toBe(1);
    expect(await count("donations")).toBe(before + 1);
    expect(await donationsOf(keyFor(20))).toHaveLength(1);
    const createdEvents = (await world.dump("audit")).filter(
      (e) => e.resourceRef === body(responses[0]!).donationId,
    );
    expect(createdEvents).toHaveLength(1);
  });

  it("10 solicitudes concurrentes con la misma clave y cargas DISTINTAS: exactamente una 201 y nueve 409", async () => {
    const before = await count("donations");
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        world.createDonation(
          donationEvent({ projectId: pid, amountCents: 1000 + i }, { key: keyFor(21) }),
        ),
      ),
    );
    const statuses = responses.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
    expect(await count("donations")).toBe(before + 1);
  });

  it("10 solicitudes concurrentes con claves distintas crean 10 donaciones", async () => {
    const before = await count("donations");
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        world.createDonation(donationEvent(valid, { key: keyFor(30 + i) })),
      ),
    );
    expect(responses.every((r) => r.statusCode === 201)).toBe(true);
    expect(new Set(responses.map((r) => body(r).donationId)).size).toBe(10);
    expect(await count("donations")).toBe(before + 10);
  });

  it("donantes distintos con la misma clave: dos donaciones, sin fuga entre ellos", async () => {
    const a = await world.createDonation(donationEvent(valid, { key: keyFor(40) }));
    const b = await world.createDonation(
      donationEvent(valid, { key: keyFor(40), sub: DONOR_B_SUB }),
    );
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(body(a).donationId).not.toBe(body(b).donationId);
    const owners = (await world.dump("donations"))
      .filter((d) => [body(a).donationId, body(b).donationId].includes(d.donationId))
      .map((d) => d.donorSub)
      .sort();
    expect(owners).toEqual([DONOR_A_SUB, DONOR_B_SUB].sort());
  });

  it("lo que manda el navegador no es la verdad: donorSub, donationId, estado, acumulado y moneda se ignoran", async () => {
    const forged = {
      ...valid,
      donorSub: DONOR_B_SUB,
      donationId: "00000000-0000-4000-8000-0000000000ee",
      status: "CONFIRMADA_SIMULADA",
      confirmedAmountCents: 9_999_999,
      currency: "USD",
      createdAt: "2000-01-01T00:00:00.000Z",
    };
    const response = await world.createDonation(donationEvent(forged, { key: keyFor(50) }));
    expect(response.statusCode).toBe(201);
    const donation = body(response);
    expect(donation.donationId).not.toBe(forged.donationId);
    expect(donation).toMatchObject({ status: "PENDIENTE_SIMULACION", currency: "PEN" });
    expect(donation.createdAt).not.toBe(forged.createdAt);
    const stored = (await world.dump("donations")).find(
      (d) => d.donationId === donation.donationId,
    )!;
    expect(stored.donorSub).toBe(DONOR_A_SUB); // del token, no del cuerpo
    expect(
      (await world.dump("projects")).find((p) => p.projectId === pid)!.confirmedAmountCents,
    ).toBe(PUBLISHED_PROJECT.confirmedAmountCents);
  });

  it("solo un DONANTE dona: GESTOR y AUDITOR reciben 403 sin escrituras", async () => {
    const before = [await count("donations"), await count("idempotency"), await count("audit")];
    const common = {
      method: "POST",
      body: valid,
      scopes: ["api/donations.write"],
      headers: { "idempotency-key": keyFor(60) },
    };
    expect(
      (await world.createDonation(gestorEvent({ ...common, sub: MANAGER_SUB }))).statusCode,
    ).toBe(403);
    expect((await world.createDonation(auditorEvent(common))).statusCode).toBe(403);
    expect([await count("donations"), await count("idempotency"), await count("audit")]).toEqual(
      before,
    );
  });

  it("el registro de idempotencia vence a las 24 horas", async () => {
    const [record] = await donationsOf(keyFor(1));
    expect(record!.expiresAt - Math.floor(Date.parse(record!.createdAt) / 1000)).toBe(86_400);
  });

  it("la clave por defecto y la de otro escenario no interfieren", async () => {
    const a = await world.createDonation(donationEvent(valid, { key: DEFAULT_KEY }));
    const b = await world.createDonation(donationEvent(valid, { key: keyFor(70) }));
    expect(body(a).donationId).not.toBe(body(b).donationId);
  });
}

describe("creación de donaciones (doble en memoria)", () => {
  scenarios(async () => makeMemoryWorld(seed()));
});

describe.skipIf(!hasLocalDynamo())("creación de donaciones (DynamoDB Local)", () => {
  scenarios(() => makeLocalWorld("donate", seed()));
});
