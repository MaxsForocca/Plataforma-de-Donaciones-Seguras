import { describe, expect, it } from "vitest";
import {
  amountCentsSchema,
  confirmedAmountCentsSchema,
  donationCreateRequestSchema,
  donationSchema,
  donationSimulateRequestSchema,
  errorEnvelopeSchema,
  goalAmountCentsSchema,
  idempotencyKeySchema,
  projectCreateRequestSchema,
  projectSchema,
} from "../src/schemas";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-11-09T12:00:00.000Z";

describe("amountCentsSchema (principio III: céntimos enteros)", () => {
  it.each([100, 101, 12_345, 99_999, 100_000])("acepta %s", (value) => {
    expect(amountCentsSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ["cero", 0],
    ["uno por debajo del mínimo", 99],
    ["uno por encima del máximo", 100_001],
    ["negativo", -100],
    ["negativo cero", -0],
    ["decimal", 100.5],
    ["decimal pequeño sobre el límite", 100_000.01],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["entero no seguro", 2 ** 53],
    ["exponente enorme", 1e21],
    ["string numérico", "100"],
    ["string con notación científica", "1e2"],
    ["string con decimales", "100.00"],
    ["string vacío", ""],
    ["null", null],
    ["undefined", undefined],
    ["booleano", true],
    ["arreglo", [100]],
    ["objeto", { amountCents: 100 }],
    ["bigint", 100n],
  ])("rechaza %s", (_label, value) => {
    expect(amountCentsSchema.safeParse(value).success).toBe(false);
  });

  it("trata 1e2 como el entero 100 una vez parseado el JSON (limitación documentada)", () => {
    expect(amountCentsSchema.safeParse(JSON.parse("1e2")).success).toBe(true);
    expect(amountCentsSchema.safeParse(JSON.parse("1.005e2")).success).toBe(false);
  });
});

describe("goalAmountCentsSchema y confirmedAmountCentsSchema", () => {
  it("la meta debe ser un entero positivo", () => {
    expect(goalAmountCentsSchema.safeParse(1).success).toBe(true);
    expect(goalAmountCentsSchema.safeParse(0).success).toBe(false);
    expect(goalAmountCentsSchema.safeParse(-1).success).toBe(false);
    expect(goalAmountCentsSchema.safeParse(1.5).success).toBe(false);
    expect(goalAmountCentsSchema.safeParse("500").success).toBe(false);
  });

  it("el acumulado acepta 0 pero no negativos ni decimales", () => {
    expect(confirmedAmountCentsSchema.safeParse(0).success).toBe(true);
    expect(confirmedAmountCentsSchema.safeParse(-1).success).toBe(false);
    expect(confirmedAmountCentsSchema.safeParse(0.1).success).toBe(false);
  });
});

describe("projectCreateRequestSchema", () => {
  const valid = { title: "Biblioteca", description: "Libros para todos", goalAmountCents: 500_000 };

  it("acepta una solicitud válida", () => {
    expect(projectCreateRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("acepta título de 120 caracteres y rechaza 121", () => {
    expect(projectCreateRequestSchema.safeParse({ ...valid, title: "a".repeat(120) }).success).toBe(
      true,
    );
    expect(projectCreateRequestSchema.safeParse({ ...valid, title: "a".repeat(121) }).success).toBe(
      false,
    );
  });

  it("acepta descripción de 2000 caracteres y rechaza 2001", () => {
    expect(
      projectCreateRequestSchema.safeParse({ ...valid, description: "a".repeat(2000) }).success,
    ).toBe(true);
    expect(
      projectCreateRequestSchema.safeParse({ ...valid, description: "a".repeat(2001) }).success,
    ).toBe(false);
  });

  it.each(["", "   ", "\n\t"])("rechaza título vacío o solo espacios (%j)", (title) => {
    expect(projectCreateRequestSchema.safeParse({ ...valid, title }).success).toBe(false);
  });

  it("recorta los espacios del título", () => {
    const result = projectCreateRequestSchema.parse({ ...valid, title: "  Biblioteca  " });
    expect(result.title).toBe("Biblioteca");
  });

  it.each(["<script>alert(1)</script>", "a < b", "x > y", "<b>hola</b>"])(
    "rechaza HTML en el título (%s)",
    (title) => {
      expect(projectCreateRequestSchema.safeParse({ ...valid, title }).success).toBe(false);
    },
  );

  it.each([0, -1, 1.5, "1000", null])("rechaza goalAmountCents = %j", (goalAmountCents) => {
    expect(projectCreateRequestSchema.safeParse({ ...valid, goalAmountCents }).success).toBe(false);
  });

  it.each([
    ["status", "PUBLICADO"],
    ["confirmedAmountCents", 999],
    ["createdBySub", "alguien"],
    ["currency", "USD"],
    ["projectId", PROJECT_ID],
  ])("rechaza el campo no permitido %s (el cliente no fija estado ni acumulado)", (key, value) => {
    expect(projectCreateRequestSchema.safeParse({ ...valid, [key]: value }).success).toBe(false);
  });

  it.each(["title", "description", "goalAmountCents"] as const)("exige %s", (key) => {
    const { [key]: _omitted, ...rest } = valid;
    expect(projectCreateRequestSchema.safeParse(rest).success).toBe(false);
  });
});

describe("donationCreateRequestSchema", () => {
  it("acepta la carga mínima", () => {
    expect(
      donationCreateRequestSchema.safeParse({ projectId: PROJECT_ID, amountCents: 100 }).success,
    ).toBe(true);
  });

  it("conserva campos adicionales (forman parte de la huella de idempotencia)", () => {
    const parsed = donationCreateRequestSchema.parse({
      projectId: PROJECT_ID,
      amountCents: 500,
      donorSub: "impostor",
      extra: 1,
    });
    expect(parsed).toMatchObject({ donorSub: "impostor", extra: 1 });
  });

  it.each(["no-es-uuid", "", 123, null])("rechaza projectId = %j", (projectId) => {
    expect(donationCreateRequestSchema.safeParse({ projectId, amountCents: 100 }).success).toBe(
      false,
    );
  });

  it("rechaza importes fuera de rango aunque haya campos extra", () => {
    expect(
      donationCreateRequestSchema.safeParse({ projectId: PROJECT_ID, amountCents: 99, extra: true })
        .success,
    ).toBe(false);
  });

  it("exige projectId y amountCents", () => {
    expect(donationCreateRequestSchema.safeParse({ amountCents: 100 }).success).toBe(false);
    expect(donationCreateRequestSchema.safeParse({ projectId: PROJECT_ID }).success).toBe(false);
    expect(donationCreateRequestSchema.safeParse({}).success).toBe(false);
    expect(donationCreateRequestSchema.safeParse(null).success).toBe(false);
    expect(donationCreateRequestSchema.safeParse([]).success).toBe(false);
  });
});

describe("donationSimulateRequestSchema", () => {
  it.each(["CONFIRMADA_SIMULADA", "RECHAZADA_SIMULADA"])("acepta %s", (outcome) => {
    expect(donationSimulateRequestSchema.safeParse({ outcome }).success).toBe(true);
  });

  it.each(["PENDIENTE_SIMULACION", "confirmada_simulada", "", 1, null])(
    "rechaza outcome = %j",
    (outcome) => {
      expect(donationSimulateRequestSchema.safeParse({ outcome }).success).toBe(false);
    },
  );

  it("rechaza campos adicionales (p. ej. un importe manipulado)", () => {
    expect(
      donationSimulateRequestSchema.safeParse({ outcome: "CONFIRMADA_SIMULADA", amountCents: 5 })
        .success,
    ).toBe(false);
  });
});

describe("idempotencyKeySchema", () => {
  it("acepta un UUID v4 y rechaza el resto", () => {
    expect(idempotencyKeySchema.safeParse("3b241101-e2bb-4255-8caf-4136c566a962").success).toBe(
      true,
    );
    expect(idempotencyKeySchema.safeParse("3b241101e2bb42558caf4136c566a962").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("clave-1").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("").success).toBe(false);
    expect(idempotencyKeySchema.safeParse(undefined).success).toBe(false);
  });
});

describe("respuestas públicas", () => {
  const project = {
    projectId: PROJECT_ID,
    title: "Biblioteca",
    description: "Libros",
    goalAmountCents: 500_000,
    confirmedAmountCents: 0,
    currency: "PEN",
    status: "PUBLICADO",
    createdAt: NOW,
    updatedAt: NOW,
  };

  it("projectSchema valida un proyecto y rechaza monedas o estados desconocidos", () => {
    expect(projectSchema.safeParse(project).success).toBe(true);
    expect(projectSchema.safeParse({ ...project, currency: "USD" }).success).toBe(false);
    expect(projectSchema.safeParse({ ...project, status: "ARCHIVADO" }).success).toBe(false);
  });

  it("donationSchema no admite donorSub (no se filtra el donante)", () => {
    const donation = {
      donationId: "00000000-0000-4000-8000-0000000000d1",
      projectId: PROJECT_ID,
      amountCents: 1000,
      currency: "PEN",
      status: "PENDIENTE_SIMULACION",
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(donationSchema.safeParse(donation).success).toBe(true);
    expect(donationSchema.safeParse({ ...donation, donorSub: "abc" }).success).toBe(false);
  });
});

describe("errorEnvelopeSchema", () => {
  it("exige code, message y requestId, sin campos adicionales", () => {
    const ok = { code: "NOT_FOUND", message: "No encontrado", requestId: "r-1" };
    expect(errorEnvelopeSchema.safeParse(ok).success).toBe(true);
    expect(errorEnvelopeSchema.safeParse({ ...ok, stack: "..." }).success).toBe(false);
    expect(errorEnvelopeSchema.safeParse({ code: "X", message: "m" }).success).toBe(false);
    expect(errorEnvelopeSchema.safeParse({ ...ok, requestId: "" }).success).toBe(false);
  });
});
