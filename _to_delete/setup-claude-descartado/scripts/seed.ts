// Punto de entrada del script de datos semilla.
// Define el formato de las fixtures (proyectos PUBLICADO y BORRADOR) y los convierte en ítems para
// la tabla Projects. La escritura real en DynamoDB se agrega con el módulo de proyectos.
// Uso: npm run seed            (simulación: imprime los ítems)

export type ProjectStatus = 'BORRADOR' | 'PUBLICADO';

export interface ProjectFixture {
  projectId: string;
  title: string;
  description: string;
  /** Meta en céntimos de PEN (entero > 0). */
  goalAmountCents: number;
  /** Monto confirmado en céntimos de PEN (entero >= 0). */
  confirmedAmountCents: number;
  status: ProjectStatus;
}

export const fixtures: ProjectFixture[] = [
  {
    projectId: 'proy-educacion-001',
    title: 'Útiles escolares para zonas rurales',
    description: 'Campaña ficticia para entregar útiles escolares a escuelas rurales.',
    goalAmountCents: 500000,
    confirmedAmountCents: 0,
    status: 'PUBLICADO',
  },
  {
    projectId: 'proy-alimentacion-001',
    title: 'Comedor comunitario',
    description: 'Campaña ficticia para financiar un comedor comunitario.',
    goalAmountCents: 1200000,
    confirmedAmountCents: 0,
    status: 'PUBLICADO',
  },
  {
    projectId: 'proy-salud-001',
    title: 'Botiquines para centros de salud',
    description: 'Borrador ficticio: aún no es visible para el público.',
    goalAmountCents: 800000,
    confirmedAmountCents: 0,
    status: 'BORRADOR',
  },
];

export function buildSeedItems(now: Date = new Date()) {
  const timestamp = now.toISOString();
  return fixtures.map((fixture) => {
    if (!Number.isInteger(fixture.goalAmountCents) || fixture.goalAmountCents <= 0) {
      throw new Error(`goalAmountCents inválido en ${fixture.projectId}`);
    }
    return { ...fixture, currency: 'PEN' as const, createdAt: timestamp, updatedAt: timestamp };
  });
}

const entrypoint = process.argv[1] ?? '';
if (entrypoint.endsWith('seed.ts')) {
  console.log(JSON.stringify(buildSeedItems(), null, 2));
}
