/**
 * T081 (T08) — Concurrencia de la simulación: 10 confirmaciones simultáneas de la misma donación
 * incrementan el acumulado EXACTAMENTE una vez (SC-004, FR-018). También: confirmaciones y rechazos
 * mezclados, 10 donaciones distintas del mismo proyecto (sin pérdida de actualizaciones) y la
 * donación ajena (T09). Mismos escenarios contra el doble en memoria y contra DynamoDB Local.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  DONOR_B_SUB,
  makeDonation,
  PUBLISHED_PROJECT,
  PUBLISHED_PROJECT_ID,
} from "../helpers/fixtures";
import { hasLocalDynamo } from "../helpers/setup";
import { makeLocalWorld, makeMemoryWorld, simulateEvent, type World } from "../helpers/world";

const idFor = (i: number) => `00000000-0000-4000-8000-${String(500 + i).padStart(12, "0")}`;
const body = (r: { body?: string }) => JSON.parse(r.body as string);
const count = (responses: { statusCode?: number }[], status: number) =>
  responses.filter((r) => r.statusCode === status).length;

const AMOUNT = 4321;
const seed = () => ({
  projects: [{ ...PUBLISHED_PROJECT, confirmedAmountCents: 0 }],
  donations: Array.from({ length: 40 }, (_, i) =>
    makeDonation({ donationId: idFor(i), amountCents: AMOUNT + i }),
  ),
});

function scenarios(getWorld: () => Promise<World>) {
  let world: World;
  beforeAll(async () => {
    world = await getWorld();
  });
  const aggregate = async () =>
    (await world.dump("projects")).find((p) => p.projectId === PUBLISHED_PROJECT_ID)!
      .confirmedAmountCents as number;
  const donation = async (id: string) =>
    (await world.dump("donations")).find((d) => d.donationId === id)!;
  const auditFor = async (id: string, type: string) =>
    (await world.dump("audit")).filter((e) => e.resourceRef === id && e.eventType === type);

  it("T08: 10 confirmaciones concurrentes de la misma donación suman UNA sola vez (una 200, nueve 409)", async () => {
    const id = idFor(0);
    const before = await aggregate();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        world.simulateDonation(simulateEvent(id, "CONFIRMADA_SIMULADA")),
      ),
    );
    expect(count(responses, 200)).toBe(1);
    expect(count(responses, 409)).toBe(9);
    expect(await aggregate()).toBe(before + AMOUNT);
    expect((await donation(id)).status).toBe("CONFIRMADA_SIMULADA");
    expect(await auditFor(id, "DONATION_CONFIRMED")).toHaveLength(1);
  });

  it("20 confirmaciones concurrentes siguen sumando una sola vez", async () => {
    const id = idFor(1);
    const before = await aggregate();
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => world.simulateDonation(simulateEvent(id))),
    );
    expect(count(responses, 200)).toBe(1);
    expect(count(responses, 409)).toBe(19);
    expect(await aggregate()).toBe(before + AMOUNT + 1);
  });

  it("confirmaciones y rechazos mezclados sobre la misma donación: exactamente un ganador y el acumulado coherente", async () => {
    const id = idFor(2);
    const before = await aggregate();
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        world.simulateDonation(
          simulateEvent(id, i % 2 === 0 ? "CONFIRMADA_SIMULADA" : "RECHAZADA_SIMULADA"),
        ),
      ),
    );
    expect(count(responses, 200)).toBe(1);
    expect(count(responses, 409)).toBe(9);
    const winner = (await donation(id)).status;
    expect(["CONFIRMADA_SIMULADA", "RECHAZADA_SIMULADA"]).toContain(winner);
    expect(await aggregate()).toBe(before + (winner === "CONFIRMADA_SIMULADA" ? AMOUNT + 2 : 0));
    const events = (await world.dump("audit")).filter((e) => e.resourceRef === id);
    expect(events).toHaveLength(1);
  });

  it("10 donaciones distintas del MISMO proyecto confirmadas a la vez: no se pierde ninguna actualización", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => idFor(10 + i));
    const before = await aggregate();
    const responses = await Promise.all(ids.map((id) => world.simulateDonation(simulateEvent(id))));
    expect(count(responses, 200)).toBe(10);
    const expected = ids.reduce((sum, _id, i) => sum + AMOUNT + 10 + i, 0);
    expect(await aggregate()).toBe(before + expected);
  });

  it("20 operaciones concurrentes (10 donaciones × confirmar y rechazar): una transición por donación y total exacto", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => idFor(20 + i));
    const before = await aggregate();
    const responses = await Promise.all(
      ids.flatMap((id) => [
        world.simulateDonation(simulateEvent(id, "CONFIRMADA_SIMULADA")),
        world.simulateDonation(simulateEvent(id, "RECHAZADA_SIMULADA")),
      ]),
    );
    expect(count(responses, 200)).toBe(10);
    expect(count(responses, 409)).toBe(10);
    const donations = await Promise.all(ids.map(donation));
    const confirmedSum = donations
      .filter((d) => d.status === "CONFIRMADA_SIMULADA")
      .reduce((s, d) => s + d.amountCents, 0);
    expect(await aggregate()).toBe(before + confirmedSum);
  });

  it("el acumulado nunca baja durante una ráfaga de operaciones", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => idFor(30 + i));
    const samples: number[] = [await aggregate()];
    const burst = Promise.all(
      ids.flatMap((id) => [
        world.simulateDonation(simulateEvent(id)),
        world.simulateDonation(simulateEvent(id)),
      ]),
    );
    samples.push(await aggregate());
    await burst;
    samples.push(await aggregate());
    for (let i = 1; i < samples.length; i += 1)
      expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]!);
  });

  it("T09: 10 intentos concurrentes de OTRO donante sobre una donación ajena → todos 404 y nada cambia", async () => {
    const id = idFor(39);
    const before = [await aggregate(), (await donation(id)).status];
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        world.simulateDonation(simulateEvent(id, "CONFIRMADA_SIMULADA", { sub: DONOR_B_SUB })),
      ),
    );
    expect(count(responses, 404)).toBe(10);
    expect(new Set(responses.map((r) => r.body)).size).toBe(1);
    expect([await aggregate(), (await donation(id)).status]).toEqual(before);
  });

  it("la respuesta ganadora refleja la transición y los perdedores no filtran datos", async () => {
    const id = idFor(3);
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => world.simulateDonation(simulateEvent(id))),
    );
    const winner = responses.find((r) => r.statusCode === 200)!;
    expect(body(winner)).toMatchObject({
      donationId: id,
      status: "CONFIRMADA_SIMULADA",
      amountCents: AMOUNT + 3,
    });
    for (const loser of responses.filter((r) => r.statusCode === 409)) {
      expect(loser.body).not.toMatch(/amountCents|CONFIRMADA_SIMULADA|donorSub/);
    }
  });
}

describe("simulación concurrente (doble en memoria)", () => {
  scenarios(async () => makeMemoryWorld(seed()));
});

describe.skipIf(!hasLocalDynamo())("simulación concurrente (DynamoDB Local)", () => {
  scenarios(() => makeLocalWorld("concur", seed()));
});
