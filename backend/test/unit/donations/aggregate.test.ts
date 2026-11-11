/**
 * T079 — El acumulado del proyecto (`confirmedAmountCents`): una confirmación lo incrementa UNA sola
 * vez con el importe almacenado; un rechazo no lo toca; nunca baja ni se duplica; cada proyecto
 * conserva el suyo (CA-06.2, CA-06.3, FR-018, FR-019, constitución III y IV).
 */
import { describe, expect, it } from "vitest";
import {
  ALL_DONATIONS,
  CONFIRMED_AMOUNT_CENTS,
  DONOR_A_SUB,
  makeDonation,
  makeProject,
  PENDING_DONATION_ID,
  PUBLISHED_PROJECT,
  PUBLISHED_PROJECT_ID,
} from "../../helpers/fixtures";
import { makeMemoryWorld, simulateEvent, simulationSeed, type World } from "../../helpers/world";

const OTHER_PROJECT_ID = "00000000-0000-4000-8000-0000000000b2";
const aggregate = async (w: World, projectId = PUBLISHED_PROJECT_ID) =>
  (await w.dump("projects")).find((p) => p.projectId === projectId)!.confirmedAmountCents as number;
const donationId = (i: number) => `00000000-0000-4000-8000-${String(100 + i).padStart(12, "0")}`;

describe("una confirmación incrementa el acumulado exactamente una vez", () => {
  it("suma el importe de la donación (S/ 25.00) al acumulado", async () => {
    const w = makeMemoryWorld(simulationSeed());
    const before = await aggregate(w);
    expect(
      (await w.simulateDonation(simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA")))
        .statusCode,
    ).toBe(200);
    expect(await aggregate(w)).toBe(before + 2500);
  });

  it("repetir la confirmación 5 veces no vuelve a sumar", async () => {
    const w = makeMemoryWorld(simulationSeed());
    const before = await aggregate(w);
    for (let i = 0; i < 5; i += 1)
      await w.simulateDonation(simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA"));
    expect(await aggregate(w)).toBe(before + 2500);
  });

  it("confirmar y luego intentar rechazar o confirmar de nuevo no cambia el acumulado", async () => {
    const w = makeMemoryWorld(simulationSeed());
    await w.simulateDonation(simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA"));
    const after = await aggregate(w);
    await w.simulateDonation(simulateEvent(PENDING_DONATION_ID, "RECHAZADA_SIMULADA"));
    await w.simulateDonation(simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA"));
    expect(await aggregate(w)).toBe(after);
  });

  it("confirmar varias donaciones suma cada una exactamente una vez", async () => {
    const donations = [100, 2500, 99_999, 100_000].map((amountCents, i) =>
      makeDonation({ donationId: donationId(i), amountCents }),
    );
    const w = makeMemoryWorld({
      projects: [{ ...PUBLISHED_PROJECT, confirmedAmountCents: 0 }],
      donations,
    });
    for (const d of donations)
      await w.simulateDonation(simulateEvent(d.donationId, "CONFIRMADA_SIMULADA"));
    expect(await aggregate(w)).toBe(100 + 2500 + 99_999 + 100_000);
  });

  it.each([100, 100_000])(
    "los importes extremos (%i céntimos) se suman exactos",
    async (amountCents) => {
      const w = makeMemoryWorld({
        projects: [{ ...PUBLISHED_PROJECT, confirmedAmountCents: 0 }],
        donations: [makeDonation({ amountCents })],
      });
      await w.simulateDonation(simulateEvent(PENDING_DONATION_ID));
      expect(await aggregate(w)).toBe(amountCents);
    },
  );

  it("un acumulado muy grande sigue siendo exacto (entero seguro) al sumar", async () => {
    const start = Number.MAX_SAFE_INTEGER - 2500;
    const w = makeMemoryWorld({
      projects: [{ ...PUBLISHED_PROJECT, confirmedAmountCents: start }],
      donations: [makeDonation()],
    });
    await w.simulateDonation(simulateEvent(PENDING_DONATION_ID));
    const total = await aggregate(w);
    expect(total).toBe(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(total)).toBe(true);
  });

  it("el acumulado es siempre un entero (sin decimales)", async () => {
    const w = makeMemoryWorld(simulationSeed());
    await w.simulateDonation(simulateEvent(PENDING_DONATION_ID));
    expect(Number.isInteger(await aggregate(w))).toBe(true);
  });
});

describe("un rechazo no incrementa nada (CA-06.3)", () => {
  it("rechazar deja el acumulado igual", async () => {
    const w = makeMemoryWorld(simulationSeed());
    const before = await aggregate(w);
    expect(
      (await w.simulateDonation(simulateEvent(PENDING_DONATION_ID, "RECHAZADA_SIMULADA")))
        .statusCode,
    ).toBe(200);
    expect(await aggregate(w)).toBe(before);
  });

  it("rechazar y luego intentar confirmar (409) no suma", async () => {
    const w = makeMemoryWorld(simulationSeed());
    const before = await aggregate(w);
    await w.simulateDonation(simulateEvent(PENDING_DONATION_ID, "RECHAZADA_SIMULADA"));
    expect(
      (await w.simulateDonation(simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA")))
        .statusCode,
    ).toBe(409);
    expect(await aggregate(w)).toBe(before);
  });

  it("el proyecto ni siquiera aparece en la transacción de un rechazo", async () => {
    const w = makeMemoryWorld(simulationSeed());
    await w.simulateDonation(simulateEvent(PENDING_DONATION_ID, "RECHAZADA_SIMULADA"));
    expect(JSON.stringify(w.calls())).not.toContain("confirmedAmountCents");
  });
});

describe("independencia entre proyectos y entre donantes", () => {
  it("confirmar una donación del proyecto A no cambia el acumulado del proyecto B", async () => {
    const other = makeProject({
      projectId: OTHER_PROJECT_ID,
      title: "Otro",
      confirmedAmountCents: 777,
    });
    const w = makeMemoryWorld({
      projects: [{ ...PUBLISHED_PROJECT }, other],
      donations: [makeDonation()],
    });
    await w.simulateDonation(simulateEvent(PENDING_DONATION_ID));
    expect(await aggregate(w, OTHER_PROJECT_ID)).toBe(777);
    expect(await aggregate(w)).toBe(PUBLISHED_PROJECT.confirmedAmountCents + 2500);
  });

  it("cada donación incrementa SU proyecto", async () => {
    const other = makeProject({ projectId: OTHER_PROJECT_ID, confirmedAmountCents: 0 });
    const donations = [
      makeDonation({ donationId: donationId(1), amountCents: 1000 }),
      makeDonation({ donationId: donationId(2), amountCents: 3000, projectId: OTHER_PROJECT_ID }),
    ];
    const w = makeMemoryWorld({
      projects: [{ ...PUBLISHED_PROJECT, confirmedAmountCents: 0 }, other],
      donations,
    });
    for (const d of donations) await w.simulateDonation(simulateEvent(d.donationId));
    expect(await aggregate(w)).toBe(1000);
    expect(await aggregate(w, OTHER_PROJECT_ID)).toBe(3000);
  });
});

describe("invariantes del acumulado (nunca baja ni se duplica)", () => {
  /** PRNG determinista (LCG) para una secuencia reproducible de operaciones. */
  function prng(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1_103_515_245 + 12_345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
  }

  it("tras una secuencia aleatoria de 60 operaciones: es monótono y igual a la suma de las confirmadas", async () => {
    const random = prng(20_261_111);
    const donations = Array.from({ length: 12 }, (_, i) =>
      makeDonation({ donationId: donationId(i), amountCents: 100 + Math.floor(random() * 99_900) }),
    );
    const w = makeMemoryWorld({
      projects: [{ ...PUBLISHED_PROJECT, confirmedAmountCents: 0 }],
      donations,
    });

    let previous = 0;
    for (let step = 0; step < 60; step += 1) {
      const target = donations[Math.floor(random() * donations.length)]!;
      const outcome = random() < 0.5 ? "CONFIRMADA_SIMULADA" : "RECHAZADA_SIMULADA";
      await w.simulateDonation(simulateEvent(target.donationId, outcome));
      const current = await aggregate(w);
      expect(current).toBeGreaterThanOrEqual(previous); // nunca baja
      previous = current;
    }

    const confirmedSum = (await w.dump("donations"))
      .filter((d) => d.status === "CONFIRMADA_SIMULADA")
      .reduce((sum, d) => sum + d.amountCents, 0);
    expect(await aggregate(w)).toBe(confirmedSum); // ni se duplica ni se pierde
    // ninguna donación pendiente o rechazada integra el total
    const nonConfirmed = (await w.dump("donations")).filter(
      (d) => d.status !== "CONFIRMADA_SIMULADA",
    );
    expect(
      nonConfirmed.every(
        (d) => d.status === "PENDIENTE_SIMULACION" || d.status === "RECHAZADA_SIMULADA",
      ),
    ).toBe(true);
  });

  it("con los datos de prueba: acumulado = confirmadas, y confirmar la pendiente suma solo su importe", async () => {
    const w = makeMemoryWorld(simulationSeed());
    const confirmed = ALL_DONATIONS.filter(
      (d) => d.projectId === PUBLISHED_PROJECT_ID && d.status === "CONFIRMADA_SIMULADA",
    ).reduce((s, d) => s + d.amountCents, 0);
    expect(await aggregate(w)).toBe(confirmed);
    expect(confirmed).toBe(CONFIRMED_AMOUNT_CENTS);
    await w.simulateDonation(simulateEvent(PENDING_DONATION_ID));
    expect(await aggregate(w)).toBe(confirmed + 2500);
  });

  it("las solicitudes rechazadas (404, 403, 400, 409) jamás modifican el acumulado", async () => {
    const w = makeMemoryWorld(simulationSeed());
    const before = await aggregate(w);
    const attempts = [
      simulateEvent("no-es-uuid"),
      simulateEvent("00000000-0000-4000-8000-0000000000ee"),
      simulateEvent(PENDING_DONATION_ID, {
        outcome: "CONFIRMADA_SIMULADA",
        amountCents: 999_999,
      } as never),
      simulateEvent(PENDING_DONATION_ID, "PENDIENTE_SIMULACION"),
      simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA", { sub: "otro-donante" }),
      simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA", { groups: ["GESTOR"] }),
      simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA", { authorizer: false }),
    ];
    for (const event of attempts) await w.simulateDonation(event);
    expect(await aggregate(w)).toBe(before);
  });

  it("la donación de otro donante no suma aunque el atacante conozca su id", async () => {
    const w = makeMemoryWorld(simulationSeed());
    const before = await aggregate(w);
    await w.simulateDonation(
      simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA", {
        sub: "otro-donante-sin-relacion",
      }),
    );
    expect(await aggregate(w)).toBe(before);
    expect(
      (await w.dump("donations")).find((d) => d.donationId === PENDING_DONATION_ID)!.donorSub,
    ).toBe(DONOR_A_SUB);
  });
});

describe("atomicidad: si la transacción falla, no queda nada a medias", () => {
  it("una cancelación tras confirmar deja donación, acumulado y auditoría intactos", async () => {
    const w = makeMemoryWorld(simulationSeed());
    w.fake!.injectFault((call) =>
      call.name === "TransactWriteCommand"
        ? Object.assign(new Error("x"), {
            name: "TransactionCanceledException",
            CancellationReasons: [
              { Code: "None" },
              { Code: "ConditionalCheckFailed" },
              { Code: "None" },
            ],
          })
        : undefined,
    );
    const before = [await w.dump("donations"), await w.dump("projects"), await w.dump("audit")];
    expect((await w.simulateDonation(simulateEvent(PENDING_DONATION_ID))).statusCode).toBe(500);
    expect([await w.dump("donations"), await w.dump("projects"), await w.dump("audit")]).toEqual(
      before,
    );
  });
});
