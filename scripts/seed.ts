/**
 * Punto de entrada de los datos semilla (FR-027). Solo identidades, proyectos y donaciones
 * ficticios; los importes son enteros en céntimos de PEN (constitución, principio III).
 *
 * Estado actual (T012): define el formato de las fixtures y las valida en modo `--dry-run`.
 * La escritura en DynamoDB y los datos completos (donaciones en los tres estados) se
 * implementan en T029. Este script NO usa credenciales ni el SDK de AWS.
 *
 * Uso: npm run seed -- [--dry-run] [--fixtures <ruta.json>]
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const PROJECT_STATUSES = ["BORRADOR", "PUBLICADO"] as const;
export const DONATION_STATUSES = [
  "PENDIENTE_SIMULACION",
  "CONFIRMADA_SIMULADA",
  "RECHAZADA_SIMULADA",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type DonationStatus = (typeof DONATION_STATUSES)[number];

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Valida el formato de las fixtures y devuelve la lista de errores (vacía si es válido). */
export function validateFixtures(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input) || !Array.isArray(input.projects) || !Array.isArray(input.donations)) {
    return ['Las fixtures deben ser un objeto con los arreglos "projects" y "donations".'];
  }

  const projectIds = new Set<string>();
  input.projects.forEach((p: unknown, i) => {
    const at = `projects[${i}]`;
    if (!isRecord(p)) return void errors.push(`${at}: debe ser un objeto.`);
    if (typeof p.projectId !== "string" || !UUID_RE.test(p.projectId)) {
      errors.push(`${at}.projectId: UUID inválido.`);
    } else if (projectIds.has(p.projectId)) {
      errors.push(`${at}.projectId: duplicado.`);
    } else {
      projectIds.add(p.projectId);
    }
    if (typeof p.title !== "string" || p.title.length < 1 || p.title.length > 120) {
      errors.push(`${at}.title: debe tener entre 1 y 120 caracteres.`);
    }
    if (
      typeof p.description !== "string" ||
      p.description.length < 1 ||
      p.description.length > 2000
    ) {
      errors.push(`${at}.description: debe tener entre 1 y 2000 caracteres.`);
    }
    if (!Number.isSafeInteger(p.goalAmountCents) || (p.goalAmountCents as number) <= 0) {
      errors.push(`${at}.goalAmountCents: debe ser un entero positivo (céntimos).`);
    }
    if (!PROJECT_STATUSES.includes(p.status as ProjectStatus)) {
      errors.push(`${at}.status: debe ser ${PROJECT_STATUSES.join(" | ")}.`);
    }
  });

  input.donations.forEach((d: unknown, i) => {
    const at = `donations[${i}]`;
    if (!isRecord(d)) return void errors.push(`${at}: debe ser un objeto.`);
    if (typeof d.donationId !== "string" || !UUID_RE.test(d.donationId)) {
      errors.push(`${at}.donationId: UUID inválido.`);
    }
    if (typeof d.projectId !== "string" || !projectIds.has(d.projectId)) {
      errors.push(`${at}.projectId: debe referenciar un proyecto de las fixtures.`);
    }
    if (typeof d.donorSub !== "string" || d.donorSub.length === 0) {
      errors.push(`${at}.donorSub: requerido.`);
    }
    if (
      !Number.isSafeInteger(d.amountCents) ||
      (d.amountCents as number) < 100 ||
      (d.amountCents as number) > 100000
    ) {
      errors.push(`${at}.amountCents: debe ser un entero entre 100 y 100000.`);
    }
    if (!DONATION_STATUSES.includes(d.status as DonationStatus)) {
      errors.push(`${at}.status: debe ser ${DONATION_STATUSES.join(" | ")}.`);
    }
  });

  return errors;
}

async function main(argv: string[]): Promise<number> {
  const fixturesFlag = argv.indexOf("--fixtures");
  const fixturesPath =
    fixturesFlag !== -1 && argv[fixturesFlag + 1]
      ? (argv[fixturesFlag + 1] as string)
      : fileURLToPath(new URL("./fixtures/seed.fixtures.json", import.meta.url));

  const fixtures: unknown = JSON.parse(await readFile(fixturesPath, "utf8"));
  const errors = validateFixtures(fixtures);
  if (errors.length > 0) {
    console.error("Fixtures inválidas:");
    for (const error of errors) console.error(`  - ${error}`);
    return 1;
  }

  const { projects, donations } = fixtures as SeedFixtures;
  const published = projects.filter((p) => p.status === "PUBLICADO").length;
  console.log(
    `Fixtures válidas: ${projects.length} proyectos (${published} PUBLICADO, ` +
      `${projects.length - published} BORRADOR), ${donations.length} donaciones.`,
  );

  if (!argv.includes("--dry-run")) {
    console.log(
      "La escritura en DynamoDB aún no está implementada (T029); no se modificó nada. " +
        "Use --dry-run para validar sin escribir.",
    );
  }
  return 0;
}

// Solo se ejecuta como script, no al importarse (p. ej. desde pruebas).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
