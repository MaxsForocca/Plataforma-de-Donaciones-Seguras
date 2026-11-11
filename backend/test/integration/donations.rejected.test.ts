/**
 * T082 — Una donación RECHAZADA_SIMULADA no incrementa ningún total y cualquier transición posterior
 * responde 409 (CA-06.2, CA-06.3, FR-019). Mismos escenarios en memoria y contra DynamoDB Local.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { makeDonation, PUBLISHED_PROJECT, PUBLISHED_PROJECT_ID } from "../helpers/fixtures";
import { hasLocalDynamo } from "../helpers/setup";
import { makeLocalWorld, makeMemoryWorld, simulateEvent, type World } from "../helpers/world";

const idFor = (i: number) => `00000000-0000-4000-8000-${String(700 + i).padStart(12, "0")}`;
const AMOUNT = 3000;
const seed = () => ({
  projects: [{ ...PUBLISHED_PROJECT, confirmedAmountCents: 500 }],
  donations: Array.from({ length: 15 }, (_, i) =>
    makeDonation({ donationId: idFor(i), amountCents: AMOUNT }),
  ),
});
const body = (r: { body?: string }) => JSON.parse(r.body as string);

function scenarios(getWorld: () => Promise<World>) {
  let world: World;
  beforeAll(async () => {
    world = await getWorld();
  });
  const aggregate = async () =>
    (await world.dump("projects")).find((p) => p.projectId === PUBLISHED_PROJECT_ID)!
      .confirmedAmountCents as number;
  const status = async (id: string) =>
    (await world.dump("donations")).find((d) => d.donationId === id)!.status as string;

  it("rechazar: 200, estado RECHAZADA_SIMULADA y acumulado SIN cambios", async () => {
    const before = await aggregate();
    const response = await world.simulateDonation(simulateEvent(idFor(0), "RECHAZADA_SIMULADA"));
    expect(response.statusCode).toBe(200);
    expect(body(response).status).toBe("RECHAZADA_SIMULADA");
    expect(await status(idFor(0))).toBe("RECHAZADA_SIMULADA");
    expect(await aggregate()).toBe(before);
  });

  it("tras rechazar, repetir el rechazo o confirmar responde 409 y el acumulado sigue igual", async () => {
    const id = idFor(1);
    await world.simulateDonation(simulateEvent(id, "RECHAZADA_SIMULADA"));
    const before = await aggregate();
    const repeat = await world.simulateDonation(simulateEvent(id, "RECHAZADA_SIMULADA"));
    const confirm = await world.simulateDonation(simulateEvent(id, "CONFIRMADA_SIMULADA"));
    expect([repeat.statusCode, confirm.statusCode]).toEqual([409, 409]);
    expect(await status(id)).toBe("RECHAZADA_SIMULADA");
    expect(await aggregate()).toBe(before);
  });

  it("10 rechazos concurrentes de la misma donación: una 200, nueve 409, un solo evento y acumulado igual", async () => {
    const id = idFor(2);
    const before = await aggregate();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        world.simulateDonation(simulateEvent(id, "RECHAZADA_SIMULADA")),
      ),
    );
    expect(responses.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.statusCode === 409)).toHaveLength(9);
    expect(await aggregate()).toBe(before);
    const events = (await world.dump("audit")).filter(
      (e) => e.resourceRef === id && e.eventType === "DONATION_REJECTED",
    );
    expect(events).toHaveLength(1);
  });

  it("registra DONATION_REJECTED y NO registra DONATION_CONFIRMED", async () => {
    const id = idFor(3);
    await world.simulateDonation(simulateEvent(id, "RECHAZADA_SIMULADA"));
    const types = (await world.dump("audit"))
      .filter((e) => e.resourceRef === id)
      .map((e) => e.eventType);
    expect(types).toEqual(["DONATION_REJECTED"]);
  });

  it("rechazar muchas donaciones no mueve el acumulado en absoluto", async () => {
    const before = await aggregate();
    const ids = Array.from({ length: 10 }, (_, i) => idFor(4 + i));
    const responses = await Promise.all(
      ids.map((id) => world.simulateDonation(simulateEvent(id, "RECHAZADA_SIMULADA"))),
    );
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    expect(await aggregate()).toBe(before);
  });

  it("un rechazo previo no impide que OTRA donación del mismo proyecto se confirme", async () => {
    const before = await aggregate();
    await world.simulateDonation(simulateEvent(idFor(14), "CONFIRMADA_SIMULADA"));
    expect(await aggregate()).toBe(before + AMOUNT);
  });
}

describe("donaciones rechazadas (doble en memoria)", () => {
  scenarios(async () => makeMemoryWorld(seed()));
});

describe.skipIf(!hasLocalDynamo())("donaciones rechazadas (DynamoDB Local)", () => {
  scenarios(() => makeLocalWorld("reject", seed()));
});
