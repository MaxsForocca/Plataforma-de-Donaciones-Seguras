import { describe, expect, it } from "vitest";
import {
  buildDeployCommands,
  buildViteEnv,
  parseArgs,
  parseOutputs,
  REGION,
  type StackOutputs,
} from "./deploy-frontend";

const outputs = (overrides: Record<string, string> = {}) =>
  Object.entries({
    SpaBucketName: "secure-donations-academic-spabucket-abc123",
    SpaDistributionId: "E2ABCDEFGHIJK",
    SpaUrl: "https://d111111abcdef8.cloudfront.net",
    ApiUrl: "https://abc123.execute-api.us-east-1.amazonaws.com/academic",
    UserPoolClientId: "client123",
    CognitoIssuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TEST",
    CognitoDomain: "secure-donations-academic-123.auth.us-east-1.amazoncognito.com",
    ...overrides,
  }).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue }));

const valid = (): StackOutputs => parseOutputs(outputs());

describe("parseArgs (seguridad)", () => {
  it("por defecto solo planifica: no ejecuta", () => {
    expect(parseArgs(["--stage", "academic"])).toEqual({
      stage: "academic",
      stackName: "secure-donations-academic",
      execute: false,
    });
  });

  it("--execute es explícito", () => {
    expect(parseArgs(["--stage", "dev", "--execute"]).execute).toBe(true);
  });

  it.each([
    [[]],
    [["--stage"]],
    [["--stage", "prod"]],
    [["--stage", "ACADEMIC"]],
    [["--stage", "--execute"]],
  ])("rechaza los argumentos %j", (argv) => {
    expect(() => parseArgs(argv)).toThrow();
  });

  it("rechaza opciones desconocidas (p. ej. --profile o --acl)", () => {
    expect(() => parseArgs(["--stage", "academic", "--profile", "x"])).toThrow(/desconocida/);
    expect(() => parseArgs(["--stage", "academic", "--acl", "public-read"])).toThrow(/desconocida/);
  });

  it.each(["x; rm -rf /", "a b", "../x", "$(id)", "-rf", ""])(
    "rechaza un nombre de pila peligroso (%j)",
    (name) => {
      expect(() => parseArgs(["--stage", "academic", "--stack-name", name])).toThrow();
    },
  );
});

describe("parseOutputs (los valores de la pila se validan antes de usarse)", () => {
  it("acepta una salida completa", () => {
    expect(valid().SpaBucketName).toBe("secure-donations-academic-spabucket-abc123");
  });

  it.each([
    "SpaBucketName",
    "SpaDistributionId",
    "SpaUrl",
    "ApiUrl",
    "UserPoolClientId",
    "CognitoIssuer",
    "CognitoDomain",
  ])("falla si falta %s", (key) => {
    expect(() => parseOutputs(outputs().filter((o) => o.OutputKey !== key))).toThrow(
      new RegExp(key),
    );
  });

  it.each([
    ["bucket con ;", { SpaBucketName: "bucket; rm -rf /" }],
    ["bucket con mayúsculas", { SpaBucketName: "MiBucket" }],
    ["bucket con espacio", { SpaBucketName: "mi bucket" }],
    ["distribución inválida", { SpaDistributionId: "abc; id" }],
    ["SpaUrl http", { SpaUrl: "http://d111.cloudfront.net" }],
    ["ApiUrl no URL", { ApiUrl: "no-es-url" }],
    ["emisor http", { CognitoIssuer: "http://cognito-idp.example.com/pool" }],
    ["dominio con esquema", { CognitoDomain: "https://x.auth.example.com" }],
    ["dominio con ruta", { CognitoDomain: "x.auth.example.com/logout" }],
  ])("rechaza %s", (_label, override) => {
    expect(() => parseOutputs(outputs(override))).toThrow();
  });

  it.each([null, undefined, "x", 42, {}])(
    "rechaza una salida que no es una lista (%j)",
    (value) => {
      expect(() => parseOutputs(value)).toThrow(/lista/);
    },
  );

  it("ignora entradas mal formadas dentro de la lista", () => {
    expect(() => parseOutputs([null, 1, { OutputKey: 5 }, ...outputs()])).not.toThrow();
  });
});

describe("buildViteEnv", () => {
  it("construye las variables VITE_* públicas a partir de la pila", () => {
    expect(buildViteEnv(valid())).toEqual({
      VITE_API_BASE_URL: "https://abc123.execute-api.us-east-1.amazonaws.com/academic",
      VITE_OIDC_AUTHORITY: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TEST",
      VITE_OIDC_CLIENT_ID: "client123",
      VITE_OIDC_REDIRECT_URI: "https://d111111abcdef8.cloudfront.net/callback",
      VITE_OIDC_LOGOUT_URI: "https://d111111abcdef8.cloudfront.net/",
      VITE_OIDC_COGNITO_DOMAIN: "secure-donations-academic-123.auth.us-east-1.amazoncognito.com",
    });
  });

  it("el retorno y el cierre de sesión usan el dominio de CloudFront (los que acepta el cliente de Cognito)", () => {
    const env = buildViteEnv(parseOutputs(outputs({ SpaUrl: "https://d222.cloudfront.net/" })));
    expect(env.VITE_OIDC_REDIRECT_URI).toBe("https://d222.cloudfront.net/callback");
    expect(env.VITE_OIDC_LOGOUT_URI).toBe("https://d222.cloudfront.net/");
  });

  it("solo expone variables con prefijo VITE_ y ningún secreto", () => {
    const keys = Object.keys(buildViteEnv(valid()));
    expect(keys.every((k) => k.startsWith("VITE_"))).toBe(true);
    expect(JSON.stringify(buildViteEnv(valid()))).not.toMatch(/secret|password|token|AKIA/i);
  });
});

describe("buildDeployCommands", () => {
  const plan = () => buildDeployCommands(valid());

  it("orden: compilar, subir recursos, subir index.html, invalidar", () => {
    expect(plan().map((c) => c.description.split(" ")[0])).toEqual([
      "Compilar",
      "Subir",
      "Subir",
      "Invalidar",
    ]);
    expect(plan()[0]).toMatchObject({ file: "npm" });
    expect(plan()[0]!.env).toBeDefined();
  });

  it("los recursos con hash se cachean un año como inmutables y index.html no se cachea", () => {
    const sync = plan()[1]!.args.join(" ");
    expect(sync).toContain("--cache-control public,max-age=31536000,immutable");
    expect(sync).toContain("--exclude index.html");
    expect(sync).toContain("--delete");
    expect(plan()[2]!.args.join(" ")).toContain(
      "--cache-control no-cache,no-store,must-revalidate",
    );
  });

  it("nunca hace público el bucket ni usa ACL ni perfiles ni claves", () => {
    const text = JSON.stringify(plan());
    expect(text).not.toMatch(/--acl|public-read|--profile|access[-_]?key|secret/i);
  });

  it("todos los comandos de AWS fijan la región y apuntan al bucket y la distribución de la pila", () => {
    const aws = plan().filter((c) => c.file === "aws");
    expect(aws.filter((c) => c.args[0] === "s3").every((c) => c.args.includes(REGION))).toBe(true);
    expect(aws.flatMap((c) => c.args)).toContain("s3://secure-donations-academic-spabucket-abc123");
    expect(aws.flatMap((c) => c.args)).toContain("E2ABCDEFGHIJK");
  });

  it("la invalidación se limita a index.html (el resto tiene nombre con hash)", () => {
    const invalidation = plan()[3]!.args;
    expect(invalidation[invalidation.indexOf("--paths") + 1]).toBe("/index.html");
  });

  it("los argumentos no contienen metacaracteres de shell aunque el bucket venga de la pila (ya validado)", () => {
    for (const command of plan()) {
      for (const arg of command.args) expect(arg).not.toMatch(/[;&|`$<>]/);
    }
  });
});
