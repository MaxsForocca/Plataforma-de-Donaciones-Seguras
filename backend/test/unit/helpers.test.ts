import { describe, expect, it } from "vitest";
import {
  ALL_DONATIONS,
  ALL_PROJECTS,
  CONFIRMED_AMOUNT_CENTS,
  CONFIRMED_DONATION,
  DRAFT_PROJECT,
  OTHER_DONOR_DONATION,
  PENDING_DONATION,
  PUBLISHED_PROJECT,
  REJECTED_DONATION,
  DONOR_A_SUB,
} from "../helpers/fixtures";
import {
  buildJwtEvent,
  createRecordingClient,
  tableDefinitions,
  testConfig,
  TEST_REQUEST_ID,
} from "../helpers/setup";

describe("fixtures (T065)", () => {
  it("incluye un proyecto PUBLICADO y uno BORRADOR", () => {
    expect(ALL_PROJECTS.map((p) => p.status).sort()).toEqual(["BORRADOR", "PUBLICADO"]);
    expect(PUBLISHED_PROJECT.status).toBe("PUBLICADO");
    expect(DRAFT_PROJECT.status).toBe("BORRADOR");
  });

  it("incluye donaciones en los tres estados", () => {
    expect(new Set(ALL_DONATIONS.map((d) => d.status))).toEqual(
      new Set(["PENDIENTE_SIMULACION", "CONFIRMADA_SIMULADA", "RECHAZADA_SIMULADA"]),
    );
  });

  it("todos los importes son enteros en céntimos y las donaciones respetan el rango", () => {
    for (const project of ALL_PROJECTS) {
      expect(Number.isInteger(project.goalAmountCents)).toBe(true);
      expect(Number.isInteger(project.confirmedAmountCents)).toBe(true);
    }
    for (const donation of ALL_DONATIONS) {
      expect(Number.isInteger(donation.amountCents)).toBe(true);
      expect(donation.amountCents).toBeGreaterThanOrEqual(100);
      expect(donation.amountCents).toBeLessThanOrEqual(100_000);
    }
  });

  it("el acumulado del proyecto publicado solo suma donaciones CONFIRMADA_SIMULADA", () => {
    const confirmed = ALL_DONATIONS.filter(
      (d) => d.projectId === PUBLISHED_PROJECT.projectId && d.status === "CONFIRMADA_SIMULADA",
    ).reduce((sum, d) => sum + d.amountCents, 0);
    expect(PUBLISHED_PROJECT.confirmedAmountCents).toBe(confirmed);
    expect(confirmed).toBe(CONFIRMED_AMOUNT_CENTS);
    expect(CONFIRMED_DONATION.amountCents).toBe(CONFIRMED_AMOUNT_CENTS);
    expect(PENDING_DONATION.status).not.toBe("CONFIRMADA_SIMULADA");
    expect(REJECTED_DONATION.status).toBe("RECHAZADA_SIMULADA");
  });

  it("hay una donación de otro donante para las pruebas BOLA", () => {
    expect(OTHER_DONOR_DONATION.donorSub).not.toBe(DONOR_A_SUB);
  });

  it("los identificadores son únicos", () => {
    const ids = [
      ...ALL_PROJECTS.map((p) => p.projectId),
      ...ALL_DONATIONS.map((d) => d.donationId),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("buildJwtEvent (T028)", () => {
  it("serializa los grupos como lo hace HTTP API: [A B]", () => {
    const event = buildJwtEvent({ groups: ["GESTOR", "DONANTE"] });
    expect(event.requestContext.authorizer.jwt.claims["cognito:groups"]).toBe("[GESTOR DONANTE]");
  });

  it("por defecto crea un access token válido de 15 minutos", () => {
    const { claims } = buildJwtEvent().requestContext.authorizer.jwt;
    expect(claims.token_use).toBe("access");
    expect(Number(claims.exp) - Math.floor(Date.parse("2026-11-11T12:00:00.000Z") / 1000)).toBe(
      900,
    );
  });

  it("authorizer: false simula una solicitud sin token", () => {
    expect(buildJwtEvent({ authorizer: false }).requestContext.authorizer).toBeUndefined();
  });

  it("transporta body, cabeceras, query y requestId del cliente sin mezclarlos con los claims", () => {
    const event = buildJwtEvent({
      body: { donorSub: "x" },
      headers: { "idempotency-key": "k" },
      query: { a: "1" },
      requestId: "rid",
    });
    expect(JSON.parse(event.body as string)).toEqual({ donorSub: "x" });
    expect(event.headers["idempotency-key"]).toBe("k");
    expect(event.requestContext.requestId).toBe("rid");
    expect(event.requestContext.authorizer.jwt.claims.donorSub).toBeUndefined();
    expect(buildJwtEvent().requestContext.requestId).toBe(TEST_REQUEST_ID);
  });

  it("claims permite eliminar un claim con undefined", () => {
    const event = buildJwtEvent({ claims: { sub: undefined } });
    expect("sub" in event.requestContext.authorizer.jwt.claims).toBe(false);
  });
});

describe("tableDefinitions (data-model.md)", () => {
  const definitions = tableDefinitions(testConfig());
  const byName = Object.fromEntries(definitions.map((d) => [d.TableName, d]));

  it("define las cuatro tablas on-demand", () => {
    expect(definitions).toHaveLength(4);
    for (const definition of definitions) expect(definition.BillingMode).toBe("PAY_PER_REQUEST");
  });

  it("Projects: PK projectId y GSI status-createdAt", () => {
    const table = byName.testProjects!;
    expect(table.KeySchema).toEqual([{ AttributeName: "projectId", KeyType: "HASH" }]);
    expect(table.GlobalSecondaryIndexes?.[0]).toMatchObject({
      IndexName: "status-createdAt",
      Projection: { ProjectionType: "ALL" },
    });
  });

  it("Donations: PK donationId y GSI donorSub-createdAt con proyección acotada", () => {
    const table = byName.testDonations!;
    expect(table.KeySchema).toEqual([{ AttributeName: "donationId", KeyType: "HASH" }]);
    expect(table.GlobalSecondaryIndexes?.[0]?.IndexName).toBe("donorSub-createdAt");
    expect(table.GlobalSecondaryIndexes?.[0]?.Projection?.NonKeyAttributes).toEqual([
      "projectId",
      "amountCents",
      "currency",
      "status",
      "updatedAt",
    ]);
  });

  it("Idempotency: PK pk; AuditEvents: eventType + sk", () => {
    expect(byName.testIdempotency!.KeySchema).toEqual([{ AttributeName: "pk", KeyType: "HASH" }]);
    expect(byName.testAuditEvents!.KeySchema).toEqual([
      { AttributeName: "eventType", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ]);
  });
});

describe("createRecordingClient", () => {
  it("registra el nombre y la entrada de cada comando", async () => {
    const client = createRecordingClient(() => ({ Item: { a: 1 } }));
    class GetCommand {
      constructor(readonly input: Record<string, unknown>) {}
    }
    const result = await (client.send as (c: unknown) => Promise<unknown>)(
      new GetCommand({ Key: 1 }),
    );
    expect(result).toEqual({ Item: { a: 1 } });
    expect(client.calls).toEqual([{ name: "GetCommand", input: { Key: 1 } }]);
  });

  it("lanza si el responder devuelve un Error", async () => {
    const client = createRecordingClient(() => new Error("boom"));
    class Cmd {
      input = {};
    }
    await expect((client.send as (c: unknown) => Promise<unknown>)(new Cmd())).rejects.toThrow(
      "boom",
    );
  });
});
