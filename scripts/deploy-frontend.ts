/**
 * Paso de despliegue de la SPA (T115): compila el frontend con las salidas de la pila, sube el build al
 * bucket PRIVADO de S3 e invalida la caché de CloudFront.
 *
 * Seguridad: por defecto solo IMPRIME el plan (no ejecuta nada). `--execute` lo ejecuta con la AWS CLI
 * y las credenciales de QUIEN lo lanza; este script nunca las guarda ni las pide. Los comandos se
 * lanzan sin shell (`execFile`) y los valores de la pila se validan antes de usarse. Nunca hace público
 * el bucket (no usa `--acl`).
 *
 * Uso: npm run deploy:frontend -- --stage academic [--execute]
 */
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

export const REGION = "us-east-1";
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const DISTRIBUTION = /^E[A-Z0-9]{8,20}$/;
const STAGES = ["academic", "dev"] as const;

export interface StackOutputs {
  SpaBucketName: string;
  SpaDistributionId: string;
  SpaUrl: string;
  ApiUrl: string;
  UserPoolClientId: string;
  CognitoIssuer: string;
  CognitoDomain: string;
}

export interface DeployOptions {
  stage: (typeof STAGES)[number];
  stackName: string;
  execute: boolean;
}

export interface Command {
  description: string;
  file: string;
  args: string[];
  env?: Record<string, string>;
}

const isHttps = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

export function parseArgs(argv: string[]): DeployOptions {
  const known = new Set(["--stage", "--stack-name", "--execute"]);
  for (const arg of argv.filter((a) => a.startsWith("--"))) {
    if (!known.has(arg)) throw new Error(`Opción desconocida: ${arg}`);
  }
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    if (index === -1) return undefined;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) throw new Error(`Falta el valor de ${flag}`);
    return next;
  };

  const stage = value("--stage");
  if (!stage || !(STAGES as readonly string[]).includes(stage)) {
    throw new Error(`--stage es obligatorio y debe ser ${STAGES.join(" | ")}`);
  }
  const stackName = value("--stack-name") ?? `secure-donations-${stage}`;
  if (!/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(stackName)) throw new Error("--stack-name inválido");
  return { stage: stage as DeployOptions["stage"], stackName, execute: argv.includes("--execute") };
}

/** Interpreta la salida de `aws cloudformation describe-stacks --query Stacks[0].Outputs`. */
export function parseOutputs(outputs: unknown): StackOutputs {
  if (!Array.isArray(outputs)) throw new Error("La salida de la pila no es una lista");
  const map = new Map<string, string>();
  for (const item of outputs) {
    const { OutputKey, OutputValue } = (item ?? {}) as {
      OutputKey?: unknown;
      OutputValue?: unknown;
    };
    if (typeof OutputKey === "string" && typeof OutputValue === "string")
      map.set(OutputKey, OutputValue);
  }
  const need = (key: keyof StackOutputs) => {
    const found = map.get(key);
    if (!found) throw new Error(`Falta la salida ${key} de la pila`);
    return found;
  };

  const result: StackOutputs = {
    SpaBucketName: need("SpaBucketName"),
    SpaDistributionId: need("SpaDistributionId"),
    SpaUrl: need("SpaUrl"),
    ApiUrl: need("ApiUrl"),
    UserPoolClientId: need("UserPoolClientId"),
    CognitoIssuer: need("CognitoIssuer"),
    CognitoDomain: need("CognitoDomain"),
  };
  if (!BUCKET.test(result.SpaBucketName)) throw new Error("SpaBucketName inválido");
  if (!DISTRIBUTION.test(result.SpaDistributionId)) throw new Error("SpaDistributionId inválido");
  for (const key of ["SpaUrl", "ApiUrl", "CognitoIssuer"] as const) {
    if (!isHttps(result[key])) throw new Error(`${key} debe ser https`);
  }
  if (!/^[a-z0-9.-]+$/i.test(result.CognitoDomain) || result.CognitoDomain.includes("/")) {
    throw new Error("CognitoDomain inválido (sin esquema ni ruta)");
  }
  return result;
}

/** Variables públicas (VITE_*) del build: nunca secretos. */
export function buildViteEnv(outputs: StackOutputs): Record<string, string> {
  const spa = outputs.SpaUrl.replace(/\/+$/, "");
  return {
    VITE_API_BASE_URL: outputs.ApiUrl.replace(/\/+$/, ""),
    VITE_OIDC_AUTHORITY: outputs.CognitoIssuer,
    VITE_OIDC_CLIENT_ID: outputs.UserPoolClientId,
    VITE_OIDC_REDIRECT_URI: `${spa}/callback`,
    VITE_OIDC_LOGOUT_URI: `${spa}/`,
    VITE_OIDC_COGNITO_DOMAIN: outputs.CognitoDomain,
  };
}

/** Plan de despliegue (se ejecuta en este orden). */
export function buildDeployCommands(outputs: StackOutputs, distDir = "frontend/dist"): Command[] {
  const bucket = `s3://${outputs.SpaBucketName}`;
  return [
    {
      description: "Compilar el frontend con la configuración de la pila",
      file: "npm",
      args: ["run", "build", "--workspace", "frontend"],
      env: buildViteEnv(outputs),
    },
    {
      description: "Subir los recursos con hash (caché larga e inmutable); elimina los obsoletos",
      file: "aws",
      args: [
        "s3",
        "sync",
        distDir,
        bucket,
        "--region",
        REGION,
        "--delete",
        "--exclude",
        "index.html",
        "--cache-control",
        "public,max-age=31536000,immutable",
      ],
    },
    {
      description:
        "Subir index.html sin caché (siempre referencia los recursos vigentes; el charset lo declara su <meta>)",
      file: "aws",
      args: [
        "s3",
        "cp",
        `${distDir}/index.html`,
        `${bucket}/index.html`,
        "--region",
        REGION,
        "--cache-control",
        "no-cache,no-store,must-revalidate",
        "--content-type",
        "text/html",
      ],
    },
    {
      description: "Invalidar index.html en CloudFront",
      file: "aws",
      args: [
        "cloudfront",
        "create-invalidation",
        "--distribution-id",
        outputs.SpaDistributionId,
        "--paths",
        "/index.html",
      ],
    },
  ];
}

async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  const described = await run(
    "aws",
    [
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      options.stackName,
      "--region",
      REGION,
      "--query",
      "Stacks[0].Outputs",
      "--output",
      "json",
    ],
    { encoding: "utf8" },
  );
  const outputs = parseOutputs(JSON.parse(described.stdout));
  const plan = buildDeployCommands(outputs);

  console.log(`Plan de despliegue de la SPA (${options.stackName}):`);
  plan.forEach((command, index) => {
    console.log(` ${index + 1}. ${command.description}\
    ${command.file} ${command.args.join(" ")}`);
  });
  if (!options.execute) {
    console.log(
      "\
Modo plan: no se ejecutó nada. Use --execute para desplegar.",
    );
    return 0;
  }

  for (const command of plan) {
    console.log(`\
→ ${command.description}`);
    const result = await run(command.file, command.args, {
      encoding: "utf8",
      env: { ...process.env, ...command.env },
      shell: process.platform === "win32", // npm/aws son .cmd en Windows; los argumentos están validados
    });
    if (result.stdout.trim()) console.log(result.stdout.trim());
  }
  console.log(`\
SPA publicada en ${outputs.SpaUrl}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Error inesperado");
    process.exitCode = 1;
  }
}
