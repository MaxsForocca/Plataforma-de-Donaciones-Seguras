/**
 * Fixtures de pruebas (T065): identidades, proyectos y donaciones ficticios en todos los estados.
 * Los importes son enteros en céntimos de PEN (principio III).
 */

export const MANAGER_SUB = "11111111-1111-4111-8111-111111111111";
export const AUDITOR_SUB = "22222222-2222-4222-8222-222222222222";
export const DONOR_A_SUB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const DONOR_B_SUB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export const PUBLISHED_PROJECT_ID = "00000000-0000-4000-8000-000000000001";
export const DRAFT_PROJECT_ID = "00000000-0000-4000-8000-000000000002";
export const MISSING_PROJECT_ID = "00000000-0000-4000-8000-0000000000ff";

export const PENDING_DONATION_ID = "00000000-0000-4000-8000-0000000000d1";
export const CONFIRMED_DONATION_ID = "00000000-0000-4000-8000-0000000000d2";
export const REJECTED_DONATION_ID = "00000000-0000-4000-8000-0000000000d3";
export const OTHER_DONOR_DONATION_ID = "00000000-0000-4000-8000-0000000000d4";

export const IDEMPOTENCY_KEY_1 = "3b241101-e2bb-4255-8caf-4136c566a962";
export const IDEMPOTENCY_KEY_2 = "9b2f6c1e-5d0a-4c58-9d3e-0f1d2c3b4a59";

export const FIXTURE_CREATED_AT = "2026-11-01T10:00:00.000Z";
export const FIXTURE_UPDATED_AT = "2026-11-01T10:00:00.000Z";

export interface ProjectItem {
  projectId: string;
  title: string;
  description: string;
  goalAmountCents: number;
  confirmedAmountCents: number;
  currency: "PEN";
  status: "BORRADOR" | "PUBLICADO";
  createdBySub: string;
  createdAt: string;
  updatedAt: string;
}

export interface DonationItem {
  donationId: string;
  projectId: string;
  donorSub: string;
  amountCents: number;
  currency: "PEN";
  status: "PENDIENTE_SIMULACION" | "CONFIRMADA_SIMULADA" | "RECHAZADA_SIMULADA";
  createdAt: string;
  updatedAt: string;
}

export function makeProject(overrides: Partial<ProjectItem> = {}): ProjectItem {
  return {
    projectId: PUBLISHED_PROJECT_ID,
    title: "Biblioteca comunitaria",
    description: "Proyecto ficticio de pruebas.",
    goalAmountCents: 500_000,
    confirmedAmountCents: 0,
    currency: "PEN",
    status: "PUBLICADO",
    createdBySub: MANAGER_SUB,
    createdAt: FIXTURE_CREATED_AT,
    updatedAt: FIXTURE_UPDATED_AT,
    ...overrides,
  };
}

export function makeDonation(overrides: Partial<DonationItem> = {}): DonationItem {
  return {
    donationId: PENDING_DONATION_ID,
    projectId: PUBLISHED_PROJECT_ID,
    donorSub: DONOR_A_SUB,
    amountCents: 2_500,
    currency: "PEN",
    status: "PENDIENTE_SIMULACION",
    createdAt: FIXTURE_CREATED_AT,
    updatedAt: FIXTURE_UPDATED_AT,
    ...overrides,
  };
}

export const CONFIRMED_AMOUNT_CENTS = 10_000;

export const PUBLISHED_PROJECT = makeProject({ confirmedAmountCents: CONFIRMED_AMOUNT_CENTS });
export const DRAFT_PROJECT = makeProject({
  projectId: DRAFT_PROJECT_ID,
  title: "Huerto escolar",
  status: "BORRADOR",
  goalAmountCents: 250_000,
});

export const PENDING_DONATION = makeDonation();
export const CONFIRMED_DONATION = makeDonation({
  donationId: CONFIRMED_DONATION_ID,
  amountCents: CONFIRMED_AMOUNT_CENTS,
  status: "CONFIRMADA_SIMULADA",
});
export const REJECTED_DONATION = makeDonation({
  donationId: REJECTED_DONATION_ID,
  amountCents: 5_000,
  status: "RECHAZADA_SIMULADA",
});
export const OTHER_DONOR_DONATION = makeDonation({
  donationId: OTHER_DONOR_DONATION_ID,
  donorSub: DONOR_B_SUB,
  amountCents: 1_000,
});

export const ALL_PROJECTS: readonly ProjectItem[] = [PUBLISHED_PROJECT, DRAFT_PROJECT];
export const ALL_DONATIONS: readonly DonationItem[] = [
  PENDING_DONATION,
  CONFIRMED_DONATION,
  REJECTED_DONATION,
  OTHER_DONOR_DONATION,
];
