/**
 * Datos semilla reproducibles (T012, T029; FR-027). Solo identidades, proyectos y donaciones
 * ficticios; los importes son enteros en céntimos de PEN (constitución, principio III).
 *
 * Seguridad: por defecto solo valida (`--dry-run`). Escribir exige `--write` y, además, o bien un
 * `--endpoint` local (DynamoDB Local) o `--confirm-aws` (usa la cadena de credenciales del
 * operador, nunca credenciales del repositorio). El acumulado `confirmedAmountCents` de cada
 * proyecto se DERIVA de las donaciones CONFIRMADA_SIMULADA; no se declara en las fixtures.
 *
 * Uso: npm run seed -- [--dry-run] [--fixtures <ruta>] [--write --endpoint http://localhost:8000]
 *                      [--write --confirm-aws --stage academic]
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  amountCentsSchema,
  descriptionSchema,
  DONATION_STATUSES,
  goalAmountCentsSchema,
  PROJECT_STATUSES,
  titleSchema,
  uuidSchema,
  type DonationStatus,
  type ProjectStatus,
} from "@donaciones/shared";

export { DONATION_STATUSES, PROJECT_STATUSES };
export type { DonationStatus, ProjectStatus };

export interface SeedProject {
  projectId: string;
  title: string;
  description: string;
  /** Meta en céntimos de PEN (entero > 0). */
  goalAmountCents: number;
  status: ProjectStatus;
}

export interface SeedDonation {
  donationId: string;
  projectId: string;
  /** `sub` ficticio del donante de prueba. */
  donorSub: string;
  /** Importe en céntimos de PEN (entero 100–100000). */
  amountCents: number;
  status: DonationStatus;
}

export interface SeedFixtures {
  projects: SeedProject[];
  donations: SeedDonation[];
}

export interface ProjectItem extends SeedProject {
  confirmedAmountCents: number;
  currency: "PEN";
  createdBySub: string;
  createdAt: string;
  updatedAt: string;
}

export interface DonationItem extends SeedDonation {
  currency: "PEN";
  createdAt: string;
  updatedAt: string;
}

export const SEED_MANAGER_SUB = "seed-manager";
const SUB_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Valida el formato de las fixtures con las mismas reglas que la API (esquemas compartidos). */
export function validateFixtures(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input) || !Array.isArray(input.projects) || !Array.isArray(input.donations)) {
    return ['Las fixtures deben ser un objeto con los arreglos "projects" y "donations".'];
  }

  const projectStatus = new Map<string, string>();
  input.projects.forEach((p: unknown, i) => {
    const at = `projects[${i}]`;
    if (!isRecord(p)) return void errors.push(`${at}: debe ser un objeto.`);
    if (!uuidSchema.safeParse(p.projectId).success) errors.push(`${at}.projectId: UUID inválido.`);
    else if (projectStatus.has(p.projectId as string)) errors.push(`${at}.projectId: duplicado.`);
    else projectStatus.set(p.projectId as string, String(p.status));
    if (!titleSchema.safeParse(p.title).success) {
      errors.push(`${at}.title: 1–120 caracteres, sin HTML.`);
    }
    if (!descriptionSchema.safeParse(p.description).success) {
      errors.push(`${at}.description: 1–2000 caracteres, sin HTML.`);
    }
    if (!goalAmountCentsSchema.safeParse(p.goalAmountCents).success) {
      errors.push(`${at}.goalAmountCents: debe ser un entero positivo (céntimos).`);
    }
    if (!(PROJECT_STATUSES as readonly unknown[]).includes(p.status)) {
      errors.push(`${at}.status: debe ser ${PROJECT_STATUSES.join(" | ")}.`);
    }
    if ("confirmedAmountCents" in p) {
      errors.push(`${at}.confirmedAmountCents: se deriva de las donaciones; no debe declararse.`);
    }
  });

  const donationIds = new Set<string>();
  input.donations.forEach((d: unknown, i) => {
    const at = `donations[${i}]`;
    if (!isRecord(d)) return void errors.push(`${at}: debe ser un objeto.`);
    if (!uuidSchema.safeParse(d.donationId).success)
      errors.push(`${at}.donationId: UUID inválido.`);
    else if (donationIds.has(d.donationId as string)) errors.push(`${at}.donationId: duplicado.`);
    else donationIds.add(d.donationId as string);

    const status = typeof d.projectId === "string" ? projectStatus.get(d.projectId) : undefined;
    if (status === undefined) {
      errors.push(`${at}.projectId: debe referenciar un proyecto de las fixtures.`);
    } else if (status !== "PUBLICADO") {
      errors.push(`${at}.projectId: un proyecto que no está PUBLICADO no acepta donaciones.`);
    }
    if (typeof d.donorSub !== "string" || !SUB_PATTERN.test(d.donorSub)) {
      errors.push(`${at}.donorSub: requerido (sin '#', espacios ni caracteres especiales).`);
    }
    if (!amountCentsSchema.safeParse(d.amountCents).success) {
      errors.push(`${at}.amountCents: debe ser un entero entre 100 y 100000.`);
    }
    if (!(DONATION_STATUSES as readonly unknown[]).includes(d.status)) {
      errors.push(`${at}.status: debe ser ${DONATION_STATUSES.join(" | ")}.`);
    }
  });

  return errors;
}

/** Convierte las fixtures (ya validadas) en items de DynamoDB; el acumulado se deriva. */
export function buildSeedItems(
  fixtures: SeedFixtures,
  now: Date = new Date(),
): { projects: ProjectItem[]; donations: DonationItem[] } {
  const minute = 60_000;
  const confirmedByProject = new Map<string, number>();
  for (const donation of fixtures.donations) {
    if (donation.status === "CONFIRMADA_SIMULADA") {
      confirmedByProject.set(
        donation.projectId,
        (confirmedByProject.get(donation.projectId) ?? 0) + donation.amountCents,
      );
    }
  }

  const projects = fixtures.projects.map((project, index) => {
    const at = new Date(now.getTime() - (fixtures.projects.length - index) * minute).toISOString();
    return {
      ...project,
      confirmedAmountCents: confirmedByProject.get(project.projectId) ?? 0,
      currency: "PEN" as const,
      createdBySub: SEED_MANAGER_SUB,
      createdAt: at,
      updatedAt: at,
    };
  });

  const donations = fixtures.donations.map((donation, index) => {
    const at = new Date(now.getTime() - (fixtures.donations.length - index) * 1000).toISOString();
    return { ...donation, currency: "PEN" as const, createdAt: at, updatedAt: at };
  });

  return { projects, donations };
}

// --- Argumentos y destino de escritura --------------------------------------------------------

export interface SeedOptions {
  fixturesPath?: string;
  write: boolean;
  endpoint?: string;
  confirmAws: boolean;
  stage: string;
  tables: { projects: string; donations: string };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const KNOWN_FLAGS = new Set([
  "--dry-run",
  "--write",
  "--confirm-aws",
  "--endpoint",
  "--fixtures",
  "--stage",
]);

/** Interpreta argumentos y entorno; lanza `Error` con un mensaje claro si algo es inseguro. */
export function parseArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): SeedOptions {
  const flags = argv.filter((arg) => arg.startsWith("--"));
  for (const flag of flags) {
    if (!KNOWN_FLAGS.has(flag)) throw new Error(`Opción desconocida: ${flag}`);
  }
  const valueOf = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    if (index === -1) return undefined;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Falta el valor de ${flag}`);
    return value;
  };

  const write = argv.includes("--write");
  if (write && argv.includes("--dry-run")) {
    throw new Error("--write y --dry-run son incompatibles");
  }
  const confirmAws = argv.includes("--confirm-aws");
  const endpoint = valueOf("--endpoint");
  const stage = valueOf("--stage") ?? env.STAGE ?? "academic";
  if (!["academic", "dev"].includes(stage)) throw new Error(`Stage inválido: ${stage}`);

  if (endpoint !== undefined) {
    let host: string;
    try {
      host = new URL(endpoint).hostname;
    } catch {
      throw new Error("--endpoint debe ser una URL válida");
    }
    if (!LOCAL_HOSTS.has(host)) throw new Error("--endpoint debe apuntar a localhost");
  }
  if (write && endpoint === undefined && !confirmAws) {
    throw new Error(
      "Escribir en AWS requiere --confirm-aws explícito (o --endpoint apuntando a DynamoDB Local).",
    );
  }

  return {
    fixturesPath: valueOf("--fixtures"),
    write,
    endpoint,
    confirmAws,
    stage,
    tables: {
      projects: env.PROJECTS_TABLE ?? `${stage}Projects`,
      donations: env.DONATIONS_TABLE ?? `${stage}Donations`,
    },
  };
}

/** Escribe proyectos y donaciones con `Put` (idempotente: mismas claves, mismo contenido). */
export async function seedTables(
  client: { send: (command: PutCommand) => Promise<unknown> },
  items: { projects: ProjectItem[]; donations: DonationItem[] },
  tables: { projects: string; donations: string },
): Promise<{ projects: number; donations: number }> {
  for (const project of items.projects) {
    await client.send(new PutCommand({ TableName: tables.projects, Item: project }));
  }
  for (const donation of items.donations) {
    await client.send(new PutCommand({ TableName: tables.donations, Item: donation }));
  }
  return { projects: items.projects.length, donations: items.donations.length };
}

async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  const fixturesPath =
    options.fixturesPath ??
    fileURLToPath(new URL("./fixtures/seed.fixtures.json", import.meta.url));

  const fixtures: unknown = JSON.parse(await readFile(fixturesPath, "utf8"));
  const errors = validateFixtures(fixtures);
  if (errors.length > 0) {
    console.error("Fixtures inválidas:");
    for (const error of errors) console.error(`  - ${error}`);
    return 1;
  }

  const items = buildSeedItems(fixtures as SeedFixtures);
  const published = items.projects.filter((p) => p.status === "PUBLICADO").length;
  console.log(
    `Fixtures válidas: ${items.projects.length} proyectos (${published} PUBLICADO, ` +
      `${items.projects.length - published} BORRADOR), ${items.donations.length} donaciones.`,
  );

  if (!options.write) {
    console.log("Modo --dry-run: no se escribió nada.");
    return 0;
  }

  const base = new DynamoDBClient(
    options.endpoint
      ? {
          endpoint: options.endpoint,
          region: "us-east-1",
          // Credenciales ficticias exclusivas del emulador local; no son credenciales de AWS.
          credentials: { accessKeyId: "local", secretAccessKey: "local" },
        }
      : {},
  );
  const client = DynamoDBDocumentClient.from(base, {
    marshallOptions: { removeUndefinedValues: true },
  });
  const written = await seedTables(client, items, options.tables);
  console.log(
    `Escritos ${written.projects} proyectos y ${written.donations} donaciones en ` +
      `${options.tables.projects} / ${options.tables.donations}` +
      `${options.endpoint ? ` (${options.endpoint})` : " (AWS)"}.`,
  );
  return 0;
}

// Solo se ejecuta como script, no al importarse (p. ej. desde pruebas).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Error inesperado");
    process.exitCode = 1;
  }
}
