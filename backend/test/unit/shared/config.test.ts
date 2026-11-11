import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError, getConfig, loadConfig, resetConfigCache } from "../../../src/shared/config";
import { TEST_CLIENT_ID, TEST_ISSUER, testEnv } from "../../helpers/setup";

function invalidKeys(env: Record<string, string | undefined>): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).invalidKeys;
  }
  throw new Error("Se esperaba ConfigError");
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigCache();
});

describe("loadConfig", () => {
  it("construye la configuración desde un entorno válido", () => {
    const config = loadConfig(testEnv());
    expect(config).toEqual({
      stage: "academic",
      isAcademic: true,
      tables: {
        projects: "testProjects",
        donations: "testDonations",
        idempotency: "testIdempotency",
        audit: "testAuditEvents",
      },
      cognito: { issuer: TEST_ISSUER, clientId: TEST_CLIENT_ID },
      allowedOrigins: ["http://localhost:5173"],
    });
  });

  it("solo el stage academic habilita la simulación", () => {
    expect(loadConfig(testEnv({ STAGE: "dev" })).isAcademic).toBe(false);
  });

  it("la configuración es inmutable", () => {
    const config = loadConfig(testEnv());
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.tables)).toBe(true);
    expect(Object.isFrozen(config.allowedOrigins)).toBe(true);
    expect(() => {
      (config as { stage: string }).stage = "dev";
    }).toThrow(TypeError);
  });

  describe("variables obligatorias", () => {
    it.each([
      "STAGE",
      "PROJECTS_TABLE",
      "DONATIONS_TABLE",
      "IDEMPOTENCY_TABLE",
      "AUDIT_TABLE",
      "COGNITO_ISSUER",
      "COGNITO_CLIENT_ID",
      "ALLOWED_ORIGINS",
    ])("falla si falta %s", (key) => {
      expect(invalidKeys(testEnv({ [key]: undefined }))).toContain(key);
    });

    it("informa todas las variables inválidas, no solo la primera", () => {
      const keys = invalidKeys({});
      expect(keys.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe("stage", () => {
    it.each(["prod", "ACADEMIC", "", " academic"])("rechaza STAGE=%j", (stage) => {
      expect(invalidKeys(testEnv({ STAGE: stage }))).toContain("STAGE");
    });
  });

  describe("nombres de tabla", () => {
    it.each(["ab", "tabla con espacios", "tabla;drop", "a/b", "x".repeat(256), ""])(
      "rechaza %j",
      (name) => {
        expect(invalidKeys(testEnv({ PROJECTS_TABLE: name }))).toContain("PROJECTS_TABLE");
      },
    );

    it("acepta los nombres de la plantilla (<Stage>Projects)", () => {
      expect(loadConfig(testEnv({ PROJECTS_TABLE: "academicProjects" })).tables.projects).toBe(
        "academicProjects",
      );
    });
  });

  describe("emisor de Cognito", () => {
    it.each(["http://cognito-idp.us-east-1.amazonaws.com/pool", "no-es-url", "ftp://x.y/z", ""])(
      "rechaza %j",
      (issuer) => {
        expect(invalidKeys(testEnv({ COGNITO_ISSUER: issuer }))).toContain("COGNITO_ISSUER");
      },
    );

    it("no incluye el valor configurado en el mensaje de error", () => {
      try {
        loadConfig(testEnv({ COGNITO_ISSUER: "http://valor-secreto.example" }));
      } catch (error) {
        expect((error as Error).message).toContain("COGNITO_ISSUER");
        expect((error as Error).message).not.toContain("valor-secreto");
        return;
      }
      throw new Error("Se esperaba ConfigError");
    });
  });

  describe("orígenes permitidos (CORS)", () => {
    it("acepta varios orígenes https y localhost por http, ignorando espacios", () => {
      const config = loadConfig(
        testEnv({ ALLOWED_ORIGINS: " https://d111.cloudfront.net , http://localhost:5173 " }),
      );
      expect(config.allowedOrigins).toEqual([
        "https://d111.cloudfront.net",
        "http://localhost:5173",
      ]);
    });

    it.each([
      ["comodín", "*"],
      ["comodín en subdominio", "https://*.example.com"],
      ["http no local", "http://example.com"],
      ["con ruta", "https://example.com/app"],
      ["con barra final", "https://example.com/"],
      ["sin esquema", "example.com"],
      ["solo espacios", "   "],
      ["solo comas", ",,"],
      ["uno válido y uno inválido", "https://example.com,*"],
      ["esquema javascript", "javascript:alert(1)"],
    ])("rechaza %s", (_label, origins) => {
      expect(invalidKeys(testEnv({ ALLOWED_ORIGINS: origins }))).toContain("ALLOWED_ORIGINS");
    });
  });

  describe("DYNAMODB_ENDPOINT (solo DynamoDB Local)", () => {
    it("acepta localhost y 127.0.0.1", () => {
      expect(
        loadConfig(testEnv({ DYNAMODB_ENDPOINT: "http://localhost:8000" })).dynamodbEndpoint,
      ).toBe("http://localhost:8000");
      expect(
        loadConfig(testEnv({ DYNAMODB_ENDPOINT: "http://127.0.0.1:8000" })).dynamodbEndpoint,
      ).toBe("http://127.0.0.1:8000");
    });

    it("vacío o ausente significa usar el endpoint real de AWS", () => {
      expect(loadConfig(testEnv({ DYNAMODB_ENDPOINT: "" })).dynamodbEndpoint).toBeUndefined();
      expect(loadConfig(testEnv()).dynamodbEndpoint).toBeUndefined();
    });

    it.each([
      "https://dynamodb.us-east-1.amazonaws.com",
      "http://evil.example:8000",
      "http://localhost.evil.example",
      "no-es-url",
      "file:///etc/passwd",
    ])("rechaza el endpoint no local %j (evita redirigir datos fuera de AWS)", (endpoint) => {
      expect(invalidKeys(testEnv({ DYNAMODB_ENDPOINT: endpoint }))).toContain("DYNAMODB_ENDPOINT");
    });
  });
});

describe("getConfig", () => {
  it("lee process.env una sola vez y cachea el resultado", () => {
    for (const [key, value] of Object.entries(testEnv())) vi.stubEnv(key, value);
    const first = getConfig();
    vi.stubEnv("STAGE", "dev");
    expect(getConfig()).toBe(first);
    expect(getConfig().stage).toBe("academic");
  });

  it("falla de forma explícita si el entorno está incompleto", () => {
    for (const key of Object.keys(testEnv())) vi.stubEnv(key, "");
    expect(() => getConfig()).toThrow(ConfigError);
  });
});
