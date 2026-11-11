/**
 * T078 — Transiciones de la simulación: solo PENDIENTE_SIMULACION pasa a CONFIRMADA_SIMULADA o
 * RECHAZADA_SIMULADA; los estados terminales responden 409; la donación de otro donante o inexistente
 * responde un 404 idéntico (T09); el importe sale de lo almacenado, nunca del cliente (CA-06.1,
 * CA-06.2, CA-07.2). La matriz genérica de roles ya vive en authz.roles.test.ts y authz.errors.test.ts;
 * aquí se comprueba el cableado de esta operación.
 */
import { describe, expect, it, vi } from "vitest";
import { actorRef } from "../../../src/audit/repository";
import { buildSimulateDonationHandler } from "../../../src/donations/handlers/simulateDonation";
import { createDonationsRepository } from "../../../src/donations/repository";
import { AppError } from "../../../src/shared/http";
import { createFakeTables } from "../../helpers/fakeTables";
import {
  AUDITOR_SUB,
  CONFIRMED_DONATION_ID,
  DONOR_A_SUB,
  MANAGER_SUB,
  DONOR_B_SUB,
  MISSING_PROJECT_ID,
  OTHER_DONOR_DONATION,
  OTHER_DONOR_DONATION_ID,
  PENDING_DONATION,
  PENDING_DONATION_ID,
  PUBLISHED_PROJECT,
  REJECTED_DONATION_ID,
} from "../../helpers/fixtures";
import {
  buildJwtEvent,
  createRecordingClient,
  donanteEvent,
  gestorEvent,
  testConfig,
} from "../../helpers/setup";
import {
  AUTH_CONFIG,
  makeMemoryWorld,
  silentLogger,
  simulateEvent,
  simulationSeed,
} from "../../helpers/world";

const world = () => makeMemoryWorld(simulationSeed());
const parsed = (r: { body?: string }) => JSON.parse(r.body as string);
const stored = async (w: ReturnType<typeof world>, id: string) =>
  (await w.dump("donations")).find((d) => d.donationId === id)!;

describe("PENDIENTE_SIMULACION → estado terminal", () => {
  it.each(["CONFIRMADA_SIMULADA", "RECHAZADA_SIMULADA"])(
    "el propietario puede pasarla a %s (200)",
    async (outcome) => {
      const w = world();
      const response = await w.simulateDonation(simulateEvent(PENDING_DONATION_ID, outcome));
      expect(response.statusCode).toBe(200);
      expect(parsed(response)).toMatchObject({
        donationId: PENDING_DONATION_ID,
        status: outcome,
        amountCents: 2500,
        currency: "PEN",
      });
      expect((await stored(w, PENDING_DONATION_ID)).status).toBe(outcome);
    },
  );

  it("la respuesta pública no incluye donorSub y cumple el esquema Donation", async () => {
    const response = await world().simulateDonation(simulateEvent(PENDING_DONATION_ID));
    expect(Object.keys(parsed(response)).sort()).toEqual(
      [
        "amountCents",
        "createdAt",
        "currency",
        "donationId",
        "projectId",
        "status",
        "updatedAt",
      ].sort(),
    );
    expect(response.body).not.toContain(DONOR_A_SUB);
  });

  it("solo cambian el estado y updatedAt: createdAt, importe, proyecto y donante se conservan", async () => {
    const w = world();
    await w.simulateDonation(simulateEvent(PENDING_DONATION_ID));
    const after = await stored(w, PENDING_DONATION_ID);
    expect(after).toMatchObject({
      createdAt: PENDING_DONATION.createdAt,
      amountCents: PENDING_DONATION.amountCents,
      projectId: PENDING_DONATION.projectId,
      donorSub: DONOR_A_SUB,
      currency: "PEN",
    });
    expect(after.updatedAt > PENDING_DONATION.updatedAt).toBe(true);
  });

  it("registra DONATION_CONFIRMED / DONATION_REJECTED con actor seudonimizado y sin datos sensibles", async () => {
    const confirmed = world();
    await confirmed.simulateDonation(
      simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA", { requestId: "req-c" }),
    );
    const rejected = world();
    await rejected.simulateDonation(
      simulateEvent(PENDING_DONATION_ID, "RECHAZADA_SIMULADA", { requestId: "req-r" }),
    );
    const [a] = await confirmed.dump("audit");
    const [b] = await rejected.dump("audit");
    expect(a).toMatchObject({
      eventType: "DONATION_CONFIRMED",
      resourceRef: PENDING_DONATION_ID,
      action: "simulateDonation",
      outcome: "SUCCESS",
      requestId: "req-c",
      actorRef: actorRef(DONOR_A_SUB),
    });
    expect(b).toMatchObject({ eventType: "DONATION_REJECTED", requestId: "req-r" });
    expect(JSON.stringify([a, b])).not.toContain(DONOR_A_SUB);
  });
});

describe("estados terminales → 409, sin ningún efecto", () => {
  const terminal = [
    ["CONFIRMADA_SIMULADA", CONFIRMED_DONATION_ID],
    ["RECHAZADA_SIMULADA", REJECTED_DONATION_ID],
  ] as const;

  for (const [state, id] of terminal) {
    for (const outcome of ["CONFIRMADA_SIMULADA", "RECHAZADA_SIMULADA"]) {
      it(`una donación ${state} no admite ${outcome} (409)`, async () => {
        const w = world();
        const before = [await w.dump("donations"), await w.dump("projects"), await w.dump("audit")];
        const response = await w.simulateDonation(simulateEvent(id, outcome));
        expect(response.statusCode).toBe(409);
        expect(parsed(response).code).toBe("CONFLICT");
        expect([
          await w.dump("donations"),
          await w.dump("projects"),
          await w.dump("audit"),
        ]).toEqual(before);
      });
    }
  }

  it("un estado terminal responde 409 SIN abrir la transacción (solo la lectura previa)", async () => {
    const w = world();
    await w.simulateDonation(simulateEvent(CONFIRMED_DONATION_ID, "RECHAZADA_SIMULADA"));
    expect(w.calls().map((c) => c.name)).toEqual(["GetCommand"]);
  });

  it("repetir la misma transición sobre la misma donación: la primera 200 y las demás 409", async () => {
    const w = world();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1)
      statuses.push(
        (await w.simulateDonation(simulateEvent(PENDING_DONATION_ID))).statusCode as number,
      );
    expect(statuses).toEqual([200, 409, 409, 409]);
  });

  it("no se puede cambiar de CONFIRMADA a RECHAZADA ni al revés", async () => {
    const w = world();
    await w.simulateDonation(simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA"));
    expect(
      (await w.simulateDonation(simulateEvent(PENDING_DONATION_ID, "RECHAZADA_SIMULADA")))
        .statusCode,
    ).toBe(409);
    expect((await stored(w, PENDING_DONATION_ID)).status).toBe("CONFIRMADA_SIMULADA");
  });

  it("un estado desconocido en la base de datos es un 500 controlado y no se modifica", async () => {
    const w = makeMemoryWorld({
      projects: [{ ...PUBLISHED_PROJECT }],
      donations: [{ ...PENDING_DONATION, status: "ARCHIVADA" }],
    });
    expect((await w.simulateDonation(simulateEvent(PENDING_DONATION_ID))).statusCode).toBe(500);
    expect((await stored(w, PENDING_DONATION_ID)).status).toBe("ARCHIVADA");
  });

  it.each([
    ["importe decimal", { amountCents: 25.5 }],
    ["importe fuera de rango", { amountCents: 5 }],
    ["moneda distinta", { currency: "USD" }],
    ["proyecto inválido", { projectId: "x" }],
  ])(
    "una donación almacenada con datos corruptos (%s) no se simula: 500",
    async (_label, patch) => {
      const w = makeMemoryWorld({
        projects: [{ ...PUBLISHED_PROJECT }],
        donations: [{ ...PENDING_DONATION, ...patch }],
      });
      expect((await w.simulateDonation(simulateEvent(PENDING_DONATION_ID))).statusCode).toBe(500);
      expect((await w.dump("projects"))[0]!.confirmedAmountCents).toBe(
        PUBLISHED_PROJECT.confirmedAmountCents,
      );
    },
  );
});

describe("propiedad y existencia (T09): 404 uniforme", () => {
  it("la donación de OTRO donante → 404 y no se modifica nada", async () => {
    const w = world();
    const before = [await w.dump("donations"), await w.dump("projects"), await w.dump("audit")];
    const response = await w.simulateDonation(simulateEvent(OTHER_DONOR_DONATION_ID));
    expect(response.statusCode).toBe(404);
    expect([await w.dump("donations"), await w.dump("projects"), await w.dump("audit")]).toEqual(
      before,
    );
  });

  it("ajena e inexistente responden EXACTAMENTE lo mismo (no se revela la existencia)", async () => {
    const w = world();
    const foreign = await w.simulateDonation(simulateEvent(OTHER_DONOR_DONATION_ID));
    const missing = await w.simulateDonation(simulateEvent("00000000-0000-4000-8000-0000000000ee"));
    expect(missing).toEqual(foreign);
    expect(foreign.body).not.toMatch(
      new RegExp(`${DONOR_B_SUB}|${OTHER_DONOR_DONATION.amountCents}|${OTHER_DONOR_DONATION_ID}`),
    );
  });

  it("también es 404 si la donación ajena ya está en estado terminal (no revela su estado)", async () => {
    const w = world();
    const response = await w.simulateDonation(
      simulateEvent(CONFIRMED_DONATION_ID, "CONFIRMADA_SIMULADA", { sub: DONOR_B_SUB }),
    );
    expect(response.statusCode).toBe(404);
  });

  it("la propiedad se decide con el sub del token: donorSub en cuerpo, query o cabeceras no concede acceso", async () => {
    const w = world();
    const response = await w.simulateDonation(
      simulateEvent(
        OTHER_DONOR_DONATION_ID,
        { outcome: "CONFIRMADA_SIMULADA", donorSub: DONOR_B_SUB },
        {
          query: { donorSub: DONOR_B_SUB },
          headers: { "x-donor-sub": DONOR_B_SUB },
        },
      ),
    );
    expect([400, 404]).toContain(response.statusCode); // el cuerpo extra se rechaza (400) antes de leer
    expect((await stored(w, OTHER_DONOR_DONATION_ID)).status).toBe("PENDIENTE_SIMULACION");
    const query = await w.simulateDonation(
      simulateEvent(OTHER_DONOR_DONATION_ID, "CONFIRMADA_SIMULADA", {
        query: { donorSub: DONOR_B_SUB },
      }),
    );
    expect(query.statusCode).toBe(404);
  });

  it.each([
    ["vacío", ""],
    ["texto", "abc"],
    ["sin guiones", "000000000000400080000000000001"],
    ["UUID con sufijo", `${PENDING_DONATION_ID}x`],
    ["salto de ruta", "../../x"],
    ["inyección", '{"$ne":null}'],
    ["muy largo", "a".repeat(10_000)],
    ["id de proyecto", MISSING_PROJECT_ID.slice(0, -2) + "ff"],
  ])("un id %s → 404 uniforme", async (_label, id) => {
    const w = world();
    const response = await w.simulateDonation(simulateEvent(id));
    expect(response.statusCode).toBe(404);
    expect(parsed(response).code).toBe("NOT_FOUND");
  });

  it("un id malformado ni siquiera consulta la base de datos", async () => {
    const w = world();
    await w.simulateDonation(simulateEvent("no-es-uuid"));
    expect(w.calls()).toHaveLength(0);
  });

  it("sin pathParameters → 404", async () => {
    const w = world();
    const event = simulateEvent(PENDING_DONATION_ID);
    delete (event as { pathParameters?: unknown }).pathParameters;
    expect((await w.simulateDonation(event)).statusCode).toBe(404);
  });
});

describe("rol y autenticación", () => {
  const asRole = (options: Parameters<typeof simulateEvent>[2]) =>
    simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA", options);

  it.each([
    ["GESTOR", asRole({ sub: MANAGER_SUB, groups: ["GESTOR"], scopes: ["api/donations.write"] })],
    ["AUDITOR", asRole({ sub: AUDITOR_SUB, groups: ["AUDITOR"], scopes: ["api/donations.write"] })],
    ["sin grupos", asRole({ groups: null })],
    ["grupo desconocido", asRole({ groups: ["ADMIN"] })],
    ["DONANTE sin el scope", asRole({ scopes: ["api/donations.read"] })],
    ["DONANTE sin ningún scope", asRole({ scopes: [] })],
  ])("%s no puede simular (403) y no se toca la base de datos", async (_label, event) => {
    const w = world();
    const response = await w.simulateDonation(event);
    expect(response.statusCode).toBe(403);
    expect(parsed(response).code).toBe("FORBIDDEN");
    expect(w.calls()).toHaveLength(0);
    expect((await stored(w, PENDING_DONATION_ID)).status).toBe("PENDIENTE_SIMULACION");
  });

  it("un GESTOR no puede simular ni siquiera la donación cuyo sub coincide con el suyo", async () => {
    const w = world();
    const event = gestorEvent({
      sub: DONOR_A_SUB,
      scopes: ["api/donations.write"],
      method: "POST",
      pathParameters: { donationId: PENDING_DONATION_ID },
      body: { outcome: "CONFIRMADA_SIMULADA" },
    });
    expect((await w.simulateDonation(event)).statusCode).toBe(403);
    expect((await stored(w, PENDING_DONATION_ID)).status).toBe("PENDIENTE_SIMULACION");
  });

  it.each([
    ["sin token", simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA", { authorizer: false })],
    ["ID token", simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA", { tokenUse: "id" })],
    [
      "token vencido",
      simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA", { expiresInSeconds: -1 }),
    ],
    [
      "token de otro cliente",
      simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA", { clientId: "otro" }),
    ],
  ])("%s → 401 sin tocar la base de datos", async (_label, event) => {
    const w = world();
    expect((await w.simulateDonation(event)).statusCode).toBe(401);
    expect(w.calls()).toHaveLength(0);
  });

  it("la autorización va antes que la validación: un GESTOR con cuerpo inválido recibe 403", async () => {
    const w = world();
    const event = gestorEvent({
      scopes: ["api/donations.write"],
      method: "POST",
      pathParameters: { donationId: PENDING_DONATION_ID },
      rawBody: "{",
    });
    expect((await w.simulateDonation(event)).statusCode).toBe(403);
  });
});

describe("validación del cuerpo (400, sin leer la base de datos)", () => {
  it.each([
    ["resultado PENDIENTE_SIMULACION", { outcome: "PENDIENTE_SIMULACION" }],
    ["resultado en minúsculas", { outcome: "confirmada_simulada" }],
    ["resultado vacío", { outcome: "" }],
    ["resultado numérico", { outcome: 1 }],
    ["resultado nulo", { outcome: null }],
    ["resultado como arreglo", { outcome: ["CONFIRMADA_SIMULADA"] }],
    ["sin resultado", {}],
    ["importe manipulado", { outcome: "CONFIRMADA_SIMULADA", amountCents: 1 }],
    ["donorSub extra", { outcome: "CONFIRMADA_SIMULADA", donorSub: DONOR_B_SUB }],
    ["estado impuesto", { outcome: "CONFIRMADA_SIMULADA", status: "CONFIRMADA_SIMULADA" }],
    ["cuerpo arreglo", []],
    ["cuerpo nulo", null],
  ])("%s → 400", async (_label, body) => {
    const w = world();
    const response = await w.simulateDonation(simulateEvent(PENDING_DONATION_ID, body as never));
    expect(response.statusCode).toBe(400);
    expect(parsed(response).code).toBe("INVALID_REQUEST");
    expect(w.calls()).toHaveLength(0);
    expect((await stored(w, PENDING_DONATION_ID)).status).toBe("PENDIENTE_SIMULACION");
  });

  it.each(["{", "no es json", "{'outcome':'x'}"])("cuerpo no JSON (%j) → 400", async (rawBody) => {
    const w = world();
    expect(
      (
        await w.simulateDonation(
          donanteEvent({
            method: "POST",
            pathParameters: { donationId: PENDING_DONATION_ID },
            rawBody,
          }),
        )
      ).statusCode,
    ).toBe(400);
  });

  it("sin cuerpo → 400", async () => {
    const w = world();
    expect(
      (
        await w.simulateDonation(
          donanteEvent({ method: "POST", pathParameters: { donationId: PENDING_DONATION_ID } }),
        )
      ).statusCode,
    ).toBe(400);
  });

  it("el 400 no revela el campo ni el valor rechazado", async () => {
    const response = await world().simulateDonation(
      simulateEvent(PENDING_DONATION_ID, { outcome: "SECRETO-777" } as never),
    );
    expect(response.body).not.toMatch(/outcome|SECRETO|777|invalid_/);
  });
});

describe("la transacción de simulación", () => {
  it("lee la donación con ConsistentRead y usa UNA transacción condicionada (confirmación: 3 items)", async () => {
    const w = world();
    await w.simulateDonation(simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA"));
    expect(w.calls().map((c) => c.name)).toEqual(["GetCommand", "TransactWriteCommand"]);
    expect(w.calls()[0]!.input.ConsistentRead).toBe(true);
    const items = w.calls()[1]!.input.TransactItems as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(items).toHaveLength(3);
    expect(items[0]!.Update).toMatchObject({
      TableName: "testDonations",
      Key: { donationId: PENDING_DONATION_ID },
      ConditionExpression: "#status = :pending AND donorSub = :sub",
      ExpressionAttributeValues: expect.objectContaining({
        ":pending": "PENDIENTE_SIMULACION",
        ":sub": DONOR_A_SUB,
      }),
    });
    expect(items[1]!.Update).toMatchObject({
      TableName: "testProjects",
      Key: { projectId: PUBLISHED_PROJECT.projectId },
      UpdateExpression: "ADD confirmedAmountCents :amount",
      ConditionExpression: "attribute_exists(projectId)",
    });
    expect(items[2]!.Put.Item.eventType).toBe("DONATION_CONFIRMED");
  });

  it("el rechazo NO toca el proyecto: solo la donación y la auditoría (2 items)", async () => {
    const w = world();
    await w.simulateDonation(simulateEvent(PENDING_DONATION_ID, "RECHAZADA_SIMULADA"));
    const items = w.calls()[1]!.input.TransactItems as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(items).toHaveLength(2);
    expect(JSON.stringify(items)).not.toContain("testProjects");
    expect(items[1]!.Put.Item.eventType).toBe("DONATION_REJECTED");
  });

  it("el importe del incremento sale de lo ALMACENADO (entero), no del cliente", async () => {
    const w = world();
    await w.simulateDonation(simulateEvent(PENDING_DONATION_ID));
    const items = w.calls()[1]!.input.TransactItems as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(items[1]!.Update.ExpressionAttributeValues[":amount"]).toBe(
      PENDING_DONATION.amountCents,
    );
    expect(Number.isInteger(items[1]!.Update.ExpressionAttributeValues[":amount"])).toBe(true);
  });

  it("solo emite lecturas GetItem y la transacción (nunca Update/Put sueltos)", async () => {
    const w = world();
    await w.simulateDonation(simulateEvent(PENDING_DONATION_ID));
    expect(new Set(w.calls().map((c) => c.name))).toEqual(
      new Set(["GetCommand", "TransactWriteCommand"]),
    );
  });
});

describe("conflictos de transacción y fallos inesperados", () => {
  const config = testConfig();
  const cancel = (...codes: string[]) =>
    Object.assign(new Error("x"), {
      name: "TransactionCanceledException",
      CancellationReasons: codes.map((Code) => ({ Code })),
    });

  function setup(options: { maxAttempts?: number } = {}) {
    const fake = createFakeTables(config, simulationSeed());
    const sleep = vi.fn(async () => {});
    const repository = createDonationsRepository(fake.client, config.tables, {
      sleep,
      maxAttempts: options.maxAttempts,
    });
    const handler = buildSimulateDonationHandler({
      repository,
      config: AUTH_CONFIG,
      academicStage: true,
      createLogger: silentLogger,
      now: () => Date.parse("2026-11-11T12:00:00.000Z"),
    });
    return { fake, sleep, handler };
  }
  const failTransactions = (fake: ReturnType<typeof createFakeTables>, errors: Error[]) =>
    fake.injectFault((call) => (call.name === "TransactWriteCommand" ? errors.shift() : undefined));

  it("TransactionConflict: reintenta con espera y completa la transición", async () => {
    const { fake, sleep, handler } = setup();
    failTransactions(fake, [cancel("TransactionConflict", "None", "None")]);
    const response = await handler(simulateEvent(PENDING_DONATION_ID));
    expect(response.statusCode).toBe(200);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(fake.dump("projects")[0]!.confirmedAmountCents).toBe(
      PUBLISHED_PROJECT.confirmedAmountCents + PENDING_DONATION.amountCents,
    );
  });

  it("conflictos persistentes: se agotan los reintentos y responde 409 sin efectos", async () => {
    const { fake, sleep, handler } = setup({ maxAttempts: 3 });
    failTransactions(
      fake,
      Array.from({ length: 5 }, () => cancel("TransactionConflict", "None", "None")),
    );
    expect((await handler(simulateEvent(PENDING_DONATION_ID))).statusCode).toBe(409);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(fake.dump("donations").find((d) => d.donationId === PENDING_DONATION_ID)!.status).toBe(
      "PENDIENTE_SIMULACION",
    );
    expect(fake.dump("projects")[0]!.confirmedAmountCents).toBe(
      PUBLISHED_PROJECT.confirmedAmountCents,
    );
  });

  it("carrera: otro cambió el estado entre la lectura y la escritura → 409 sin efectos", async () => {
    const { fake, handler } = setup();
    failTransactions(fake, [cancel("ConditionalCheckFailed", "None", "None")]);
    expect((await handler(simulateEvent(PENDING_DONATION_ID))).statusCode).toBe(409);
    expect(fake.dump("audit")).toHaveLength(0);
  });

  it("el proyecto de la donación no existe (incoherencia de datos) → 500 y la donación NO cambia", async () => {
    const fake = createFakeTables(config, { projects: [], donations: [{ ...PENDING_DONATION }] });
    const handler = buildSimulateDonationHandler({
      repository: createDonationsRepository(fake.client, config.tables, { sleep: async () => {} }),
      config: AUTH_CONFIG,
      academicStage: true,
      createLogger: silentLogger,
      now: () => Date.parse("2026-11-11T12:00:00.000Z"),
    });
    expect((await handler(simulateEvent(PENDING_DONATION_ID))).statusCode).toBe(500);
    expect(fake.dump("donations")[0]!.status).toBe("PENDIENTE_SIMULACION");
    expect(fake.dump("audit")).toHaveLength(0);
  });

  it.each([
    ["ThrottlingError", cancel("ThrottlingError", "None", "None")],
    ["ValidationError", cancel("ValidationError", "None", "None")],
    [
      "cancelación sin razones",
      Object.assign(new Error("x"), { name: "TransactionCanceledException" }),
    ],
  ])("cancelación inesperada (%s) → 500 sin efectos", async (_label, error) => {
    const { fake, handler } = setup();
    failTransactions(fake, [error]);
    expect((await handler(simulateEvent(PENDING_DONATION_ID))).statusCode).toBe(500);
    expect(fake.dump("audit")).toHaveLength(0);
  });

  it("un error de la base de datos es un 500 uniforme sin filtrar el mensaje", async () => {
    const client = createRecordingClient(() =>
      Object.assign(new Error("arn:aws:dynamodb:us-east-1:123456789012:table/x"), {
        name: "AccessDeniedException",
      }),
    );
    const handler = buildSimulateDonationHandler({
      repository: createDonationsRepository(client, config.tables),
      config: AUTH_CONFIG,
      academicStage: true,
      createLogger: silentLogger,
      now: () => Date.parse("2026-11-11T12:00:00.000Z"),
    });
    const response = await handler(simulateEvent(PENDING_DONATION_ID));
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toMatch(/arn:aws|123456789012/);
  });

  it("el repositorio lanza AppError (no errores crudos) al simular un estado terminal", async () => {
    const fake = createFakeTables(config, simulationSeed());
    const repository = createDonationsRepository(fake.client, config.tables);
    const raw = (await fake.client.send({
      constructor: { name: "GetCommand" },
      input: { TableName: "testDonations", Key: { donationId: CONFIRMED_DONATION_ID } },
    } as never)) as { Item: Record<string, unknown> };
    const error = await repository
      .simulateDonation({
        donation: raw.Item,
        donorSub: DONOR_A_SUB,
        outcome: "CONFIRMADA_SIMULADA",
        requestId: "r",
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(409);
  });
});

describe("la ruta solo existe en el stage academic (defensa en profundidad del handler)", () => {
  function nonAcademic() {
    const fake = createFakeTables(testConfig({ STAGE: "dev" }), simulationSeed());
    const handler = buildSimulateDonationHandler({
      repository: createDonationsRepository(fake.client, testConfig({ STAGE: "dev" }).tables),
      config: AUTH_CONFIG,
      academicStage: false,
      createLogger: silentLogger,
      now: () => Date.parse("2026-11-11T12:00:00.000Z"),
    });
    return { fake, handler };
  }

  it("fuera de academic cualquier solicitud responde 404 uniforme y no toca la base de datos", async () => {
    const { fake, handler } = nonAcademic();
    const response = await handler(simulateEvent(PENDING_DONATION_ID));
    expect(response.statusCode).toBe(404);
    expect(parsed(response).code).toBe("NOT_FOUND");
    expect(fake.client.calls).toHaveLength(0);
    expect(fake.dump("donations").find((d) => d.donationId === PENDING_DONATION_ID)!.status).toBe(
      "PENDIENTE_SIMULACION",
    );
  });

  it("el 404 no distingue entre autenticado, sin token o con otro rol (la ruta simplemente no existe)", async () => {
    const { handler } = nonAcademic();
    const bodies = new Set(
      await Promise.all(
        [
          simulateEvent(PENDING_DONATION_ID),
          simulateEvent(PENDING_DONATION_ID, "CONFIRMADA_SIMULADA", { authorizer: false }),
          buildJwtEvent({ method: "POST", pathParameters: { donationId: PENDING_DONATION_ID } }),
        ].map(async (e) => (await handler(e)).statusCode),
      ),
    );
    expect([...bodies]).toEqual([404]);
  });
});
