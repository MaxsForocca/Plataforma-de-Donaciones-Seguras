import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { buildSeedItems, parseArgs, seedTables, validateFixtures, type SeedFixtures } from "./seed";

const NOW = new Date("2026-11-11T12:00:00.000Z");
const FIXTURES_PATH = fileURLToPath(new URL("./fixtures/seed.fixtures.json", import.meta.url));

async function loadFixtures(): Promise<SeedFixtures> {
  return JSON.parse(await readFile(FIXTURES_PATH, "utf8")) as SeedFixtures;
}
const clone = <T>(value: T): T => structuredClone(value);

describe("fixtures incluidas (FR-027, SC-012)", () => {
  it("son válidas", async () => {
    expect(validateFixtures(await loadFixtures())).toEqual([]);
  });

  it("incluyen al menos un proyecto PUBLICADO y uno BORRADOR", async () => {
    const { projects } = await loadFixtures();
    expect(projects.some((p) => p.status === "PUBLICADO")).toBe(true);
    expect(projects.some((p) => p.status === "BORRADOR")).toBe(true);
  });

  it("incluyen donaciones en los tres estados", async () => {
    const { donations } = await loadFixtures();
    expect(new Set(donations.map((d) => d.status))).toEqual(
      new Set(["PENDIENTE_SIMULACION", "CONFIRMADA_SIMULADA", "RECHAZADA_SIMULADA"]),
    );
  });

  it("incluyen donaciones de al menos dos donantes (pruebas BOLA)", async () => {
    const { donations } = await loadFixtures();
    expect(new Set(donations.map((d) => d.donorSub)).size).toBeGreaterThanOrEqual(2);
  });

  it("ninguna donación apunta a un BORRADOR", async () => {
    const { projects, donations } = await loadFixtures();
    const drafts = new Set(projects.filter((p) => p.status === "BORRADOR").map((p) => p.projectId));
    expect(donations.some((d) => drafts.has(d.projectId))).toBe(false);
  });
});

describe("buildSeedItems", () => {
  it("deriva el acumulado solo de donaciones CONFIRMADA_SIMULADA", async () => {
    const fixtures = await loadFixtures();
    const { projects } = buildSeedItems(fixtures, NOW);
    const first = projects.find((p) => p.projectId === fixtures.projects[0]!.projectId)!;
    // 10 000 + 15 000 confirmadas; la pendiente (2 500) y la rechazada (5 000) no suman.
    expect(first.confirmedAmountCents).toBe(25_000);
  });

  it("un proyecto sin donaciones confirmadas tiene acumulado 0 (pendientes y borradores incluidos)", async () => {
    const fixtures = await loadFixtures();
    const { projects } = buildSeedItems(fixtures, NOW);
    expect(
      projects.find((p) => p.projectId === fixtures.projects[1]!.projectId)!.confirmedAmountCents,
    ).toBe(0);
    expect(projects.find((p) => p.status === "BORRADOR")!.confirmedAmountCents).toBe(0);
  });

  it("el total de los proyectos coincide con la suma de donaciones confirmadas", async () => {
    const fixtures = await loadFixtures();
    const { projects } = buildSeedItems(fixtures, NOW);
    const expected = fixtures.donations
      .filter((d) => d.status === "CONFIRMADA_SIMULADA")
      .reduce((sum, d) => sum + d.amountCents, 0);
    expect(projects.reduce((sum, p) => sum + p.confirmedAmountCents, 0)).toBe(expected);
  });

  it("todos los importes son enteros y la moneda es PEN", async () => {
    const { projects, donations } = buildSeedItems(await loadFixtures(), NOW);
    for (const p of projects) {
      expect(Number.isInteger(p.goalAmountCents)).toBe(true);
      expect(Number.isInteger(p.confirmedAmountCents)).toBe(true);
      expect(p.currency).toBe("PEN");
    }
    for (const d of donations) {
      expect(Number.isInteger(d.amountCents)).toBe(true);
      expect(d.currency).toBe("PEN");
    }
  });

  it("es reproducible: la misma hora produce los mismos items", async () => {
    const fixtures = await loadFixtures();
    expect(buildSeedItems(fixtures, NOW)).toEqual(buildSeedItems(fixtures, NOW));
  });

  it("genera marcas de tiempo ISO anteriores a la hora de referencia, ordenadas por creación", async () => {
    const { projects } = buildSeedItems(await loadFixtures(), NOW);
    const times = projects.map((p) => Date.parse(p.createdAt));
    expect(times.every((t) => t < NOW.getTime())).toBe(true);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(projects[0]!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("no modifica las fixtures de entrada", async () => {
    const fixtures = await loadFixtures();
    const before = clone(fixtures);
    buildSeedItems(fixtures, NOW);
    expect(fixtures).toEqual(before);
  });

  it("no genera datos de tarjeta ni de pago", async () => {
    const text = JSON.stringify(buildSeedItems(await loadFixtures(), NOW));
    expect(text).not.toMatch(/card|cvv|dni|iban|tarjeta/i);
  });
});

describe("validateFixtures (casos negativos)", () => {
  const withDonation = async (patch: Record<string, unknown>) => {
    const fixtures = clone(await loadFixtures()) as unknown as {
      donations: Record<string, unknown>[];
    };
    Object.assign(fixtures.donations[0]!, patch);
    return validateFixtures(fixtures);
  };
  const withProject = async (patch: Record<string, unknown>) => {
    const fixtures = clone(await loadFixtures()) as unknown as {
      projects: Record<string, unknown>[];
    };
    Object.assign(fixtures.projects[0]!, patch);
    return validateFixtures(fixtures);
  };

  it.each([null, undefined, 42, "x", [], {}, { projects: [] }, { donations: [] }])(
    "rechaza una estructura raíz inválida (%j)",
    (input) => {
      expect(validateFixtures(input)).toHaveLength(1);
    },
  );

  it.each([
    ["importe 0", 0],
    ["importe 99", 99],
    ["importe 100001", 100_001],
    ["importe decimal", 100.5],
    ["importe como texto", "500"],
    ["importe negativo", -100],
    ["importe NaN", Number.NaN],
  ])("rechaza %s en una donación", async (_label, amountCents) => {
    expect((await withDonation({ amountCents })).join()).toMatch(/amountCents/);
  });

  it.each([100, 100_000])("acepta el importe límite %i", async (amountCents) => {
    expect(await withDonation({ amountCents })).toEqual([]);
  });

  it.each([
    ["meta 0", { goalAmountCents: 0 }],
    ["meta decimal", { goalAmountCents: 10.5 }],
    ["meta negativa", { goalAmountCents: -1 }],
    ["título vacío", { title: "" }],
    ["título de 121 caracteres", { title: "a".repeat(121) }],
    ["título con HTML", { title: "<script>x</script>" }],
    ["estado desconocido", { status: "ARCHIVADO" }],
    ["id no UUID", { projectId: "p1" }],
  ])("rechaza %s en un proyecto", async (_label, patch) => {
    expect((await withProject(patch)).length).toBeGreaterThan(0);
  });

  it("no permite declarar confirmedAmountCents (debe derivarse)", async () => {
    expect((await withProject({ confirmedAmountCents: 999 })).join()).toMatch(/derivar|deriva/);
  });

  it("rechaza una donación a un proyecto BORRADOR", async () => {
    const fixtures = await loadFixtures();
    const draft = fixtures.projects.find((p) => p.status === "BORRADOR")!;
    expect((await withDonation({ projectId: draft.projectId })).join()).toMatch(/PUBLICADO/);
  });

  it("rechaza una donación a un proyecto inexistente", async () => {
    expect(
      (await withDonation({ projectId: "00000000-0000-4000-8000-0000000000ff" })).join(),
    ).toMatch(/proyecto de las fixtures/);
  });

  it.each(["", "con espacio", "a#b", "x".repeat(129), 5, null])(
    "rechaza donorSub inválido (%j)",
    async (donorSub) => {
      expect((await withDonation({ donorSub })).join()).toMatch(/donorSub/);
    },
  );

  it("rechaza estados y UUID de donación inválidos", async () => {
    expect((await withDonation({ status: "PAGADA" })).join()).toMatch(/status/);
    expect((await withDonation({ donationId: "d1" })).join()).toMatch(/donationId/);
  });

  it("rechaza identificadores duplicados", async () => {
    const fixtures = clone(await loadFixtures());
    fixtures.donations[1]!.donationId = fixtures.donations[0]!.donationId;
    fixtures.projects[1]!.projectId = fixtures.projects[0]!.projectId;
    const message = validateFixtures(fixtures).join();
    expect(message).toMatch(/donationId.*duplicado/);
    expect(message).toMatch(/projectId.*duplicado/);
  });

  it("informa todos los errores a la vez", async () => {
    const fixtures = clone(await loadFixtures());
    fixtures.projects[0]!.title = "";
    fixtures.donations[0]!.amountCents = 1;
    expect(validateFixtures(fixtures).length).toBeGreaterThanOrEqual(2);
  });
});

describe("parseArgs (seguridad de la escritura)", () => {
  it("por defecto solo valida y no escribe", () => {
    const options = parseArgs([], {});
    expect(options.write).toBe(false);
    expect(options.stage).toBe("academic");
  });

  it("--dry-run no escribe", () => {
    expect(parseArgs(["--dry-run"], {}).write).toBe(false);
  });

  it("--write sin endpoint local ni --confirm-aws se rechaza (evita escribir en AWS por accidente)", () => {
    expect(() => parseArgs(["--write"], {})).toThrow(/--confirm-aws/);
  });

  it("--write con DynamoDB Local es válido sin confirmación", () => {
    const options = parseArgs(["--write", "--endpoint", "http://localhost:8000"], {});
    expect(options).toMatchObject({ write: true, endpoint: "http://localhost:8000" });
  });

  it("--write --confirm-aws es válido", () => {
    expect(parseArgs(["--write", "--confirm-aws"], {}).confirmAws).toBe(true);
  });

  it.each(["https://dynamodb.us-east-1.amazonaws.com", "http://evil.example:8000", "no-es-url"])(
    "rechaza un endpoint no local (%s)",
    (endpoint) => {
      expect(() => parseArgs(["--write", "--endpoint", endpoint], {})).toThrow(/endpoint/);
    },
  );

  it("--write y --dry-run son incompatibles", () => {
    expect(() => parseArgs(["--write", "--dry-run", "--confirm-aws"], {})).toThrow(/incompatibles/);
  });

  it("rechaza opciones desconocidas y valores ausentes", () => {
    expect(() => parseArgs(["--force"], {})).toThrow(/desconocida/);
    expect(() => parseArgs(["--endpoint"], {})).toThrow(/Falta el valor/);
    expect(() => parseArgs(["--stage", "--write"], {})).toThrow(/Falta el valor/);
  });

  it.each(["prod", "ACADEMIC", ""])("rechaza el stage inválido %j", (stage) => {
    expect(() => parseArgs(["--stage", stage || "x"], {})).toThrow(/Stage/);
  });

  it("resuelve nombres de tabla por stage o por variables de entorno", () => {
    expect(parseArgs(["--stage", "dev"], {}).tables).toEqual({
      projects: "devProjects",
      donations: "devDonations",
    });
    expect(
      parseArgs([], { PROJECTS_TABLE: "P", DONATIONS_TABLE: "D", STAGE: "dev" }).tables,
    ).toEqual({ projects: "P", donations: "D" });
  });
});

describe("seedTables", () => {
  it("escribe cada proyecto y cada donación en su tabla", async () => {
    const send = vi.fn(async (_command: PutCommand) => ({}));
    const items = buildSeedItems(await loadFixtures(), NOW);
    const written = await seedTables({ send }, items, { projects: "TP", donations: "TD" });

    expect(written).toEqual({ projects: 3, donations: 5 });
    expect(send).toHaveBeenCalledTimes(8);
    const tables = send.mock.calls.map(([command]) => command.input.TableName);
    expect(tables.filter((t) => t === "TP")).toHaveLength(3);
    expect(tables.filter((t) => t === "TD")).toHaveLength(5);
    expect(send.mock.calls[0]![0]).toBeInstanceOf(PutCommand);
  });

  it("no usa condiciones: es idempotente al repetirse con las mismas claves", async () => {
    const send = vi.fn(async (_command: PutCommand) => ({}));
    await seedTables({ send }, buildSeedItems(await loadFixtures(), NOW), {
      projects: "TP",
      donations: "TD",
    });
    for (const [command] of send.mock.calls) {
      expect(command.input.ConditionExpression).toBeUndefined();
    }
  });

  it("se detiene ante el primer error de la base de datos", async () => {
    const send = vi.fn(async (_command: PutCommand) => {
      throw new Error("fallo");
    });
    await expect(
      seedTables({ send }, buildSeedItems(await loadFixtures(), NOW), {
        projects: "TP",
        donations: "TD",
      }),
    ).rejects.toThrow("fallo");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
