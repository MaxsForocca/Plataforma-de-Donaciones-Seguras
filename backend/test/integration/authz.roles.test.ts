/**
 * T052 — Control de acceso por rol y por propietario, de punta a punta con el middleware real
 * (`withAuth`): DONANTE no crea ni publica proyectos (403), GESTOR/AUDITOR no ven el historial de un
 * donante (403/404 sin filtración), un recurso ajeno responde 404, y los campos de identidad del
 * cliente no tienen efecto (CA-04.1, CA-04.2, CA-04.3, CA-07.2).
 *
 * Los handlers son sondas que ESCRIBEN en un almacén registrador: si el acceso se deniega, no debe
 * haber ninguna escritura ("no se modifica ningún proyecto").
 */
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, describe, expect, it } from "vitest";
import { ACTIONS, authorizeOwned, type Action } from "../../src/authz/policies";
import { withAuth } from "../../src/authz/middleware";
import { jsonResponse } from "../../src/shared/http";
import { createLogger } from "../../src/shared/logger";
import {
  AUDITOR_SUB,
  CONFIRMED_DONATION_ID,
  DONOR_A_SUB,
  DONOR_B_SUB,
  MANAGER_SUB,
  makeDonation,
  OTHER_DONOR_DONATION,
  OTHER_DONOR_DONATION_ID,
  PENDING_DONATION,
  PENDING_DONATION_ID,
  PUBLISHED_PROJECT_ID,
} from "../helpers/fixtures";
import {
  buildJwtEvent,
  createLocalClients,
  createRecordingClient,
  FIXED_NOW_MS,
  hasLocalDynamo,
  isolatedConfig,
  resetTables,
  TEST_CLIENT_ID,
  TEST_ISSUER,
} from "../helpers/setup";

const ALL_SCOPES = [
  "api/projects.write",
  "api/donations.write",
  "api/donations.read",
  "api/audit.read",
];

type Identity = { label: string; sub: string; groups: string[] | null };
const IDENTITIES: Identity[] = [
  { label: "DONANTE", sub: DONOR_A_SUB, groups: ["DONANTE"] },
  { label: "GESTOR", sub: MANAGER_SUB, groups: ["GESTOR"] },
  { label: "AUDITOR", sub: AUDITOR_SUB, groups: ["AUDITOR"] },
  { label: "sin grupos", sub: DONOR_A_SUB, groups: null },
  { label: "grupo desconocido (ADMIN)", sub: DONOR_A_SUB, groups: ["ADMIN"] },
];

const OPERATIONS: { name: string; action: Action }[] = [
  { name: "createProject", action: "project:create" },
  { name: "publishProject", action: "project:publish" },
  { name: "createDonation", action: "donation:create" },
  { name: "simulateDonation", action: "donation:simulate" },
  { name: "listMyDonations", action: "donation:list-own" },
  { name: "getDonation", action: "donation:read-own" },
  { name: "readAudit", action: "audit:read" },
];

const eventFor = (identity: Identity, options: Parameters<typeof buildJwtEvent>[0] = {}) =>
  buildJwtEvent({
    sub: identity.sub,
    groups: identity.groups,
    scopes: ALL_SCOPES,
    requestId: "req-roles",
    ...options,
  });

/** Sonda: ejecuta una escritura y devuelve la identidad que la lógica de negocio recibió. */
function probe(operation: { name: string; action: Action }) {
  const store = createRecordingClient();
  const handler = withAuth(
    {
      name: operation.name,
      action: operation.action,
      config: { clientId: TEST_CLIENT_ID, issuer: TEST_ISSUER },
      now: () => FIXED_NOW_MS,
      createLogger: (id) => createLogger(id, { sink: () => {} }),
    },
    async ({ principal }) => {
      await store.send(new PutCommand({ TableName: "t", Item: { by: principal.sub } }) as never);
      return jsonResponse(200, { sub: principal.sub, roles: principal.roles });
    },
  );
  return { handler, store };
}

describe("matriz rol × operación (RBAC en el servidor)", () => {
  for (const operation of OPERATIONS) {
    for (const identity of IDENTITIES) {
      const allowed = (identity.groups ?? []).some((group) =>
        (ACTIONS[operation.action].roles as readonly string[]).includes(group),
      );
      it(`${identity.label} ${allowed ? "puede" : "NO puede"} ${operation.name}`, async () => {
        const { handler, store } = probe(operation);
        const response = await handler(eventFor(identity));
        expect(response.statusCode).toBe(allowed ? 200 : 403);
        expect(store.calls).toHaveLength(allowed ? 1 : 0); // denegado ⇒ ninguna escritura
      });
    }
  }
});

describe("CA-04.1: un DONANTE no crea, modifica ni publica proyectos", () => {
  it.each([
    ["crear", "project:create"],
    ["publicar", "project:publish"],
  ] as const)("%s → 403 y ningún proyecto se modifica", async (_label, action) => {
    const { handler, store } = probe({ name: "x", action });
    const response = await handler(eventFor(IDENTITIES[0]!));
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body as string)).toMatchObject({ code: "FORBIDDEN" });
    expect(store.calls).toHaveLength(0);
  });

  it("aunque el cuerpo, la query o las cabeceras afirmen ser GESTOR", async () => {
    const { handler, store } = probe({ name: "createProject", action: "project:create" });
    const response = await handler(
      eventFor(IDENTITIES[0]!, {
        body: {
          roles: ["GESTOR"],
          groups: ["GESTOR"],
          "cognito:groups": ["GESTOR"],
          role: "GESTOR",
        },
        query: { role: "GESTOR", groups: "GESTOR" },
        headers: {
          "x-user-groups": "GESTOR",
          "x-amzn-oidc-data": "GESTOR",
          authorization: "Bearer GESTOR",
        },
      }),
    );
    expect(response.statusCode).toBe(403);
    expect(store.calls).toHaveLength(0);
  });

  it("el rol correcto sin el scope correcto sigue siendo 403 (los scopes no se omiten)", async () => {
    const { handler, store } = probe({ name: "createProject", action: "project:create" });
    const response = await handler(eventFor(IDENTITIES[1]!, { scopes: ["api/donations.read"] }));
    expect(response.statusCode).toBe(403);
    expect(store.calls).toHaveLength(0);
  });
});

describe("CA-04.3: la identidad sale solo del token verificado", () => {
  it("donorSub, sub y roles del cliente no cambian la identidad que recibe la lógica", async () => {
    const { handler } = probe({ name: "createDonation", action: "donation:create" });
    const response = await handler(
      eventFor(IDENTITIES[0]!, {
        body: {
          projectId: PUBLISHED_PROJECT_ID,
          amountCents: 500,
          donorSub: DONOR_B_SUB,
          sub: DONOR_B_SUB,
          roles: ["GESTOR"],
        },
        query: { donorSub: DONOR_B_SUB },
        headers: { "x-donor-sub": DONOR_B_SUB },
      }),
    );
    const body = JSON.parse(response.body as string);
    expect(body.sub).toBe(DONOR_A_SUB);
    expect(body.roles).toEqual(["DONANTE"]);
  });

  it("un token de otro cliente o un ID token no llegan a la lógica (401), con cualquier rol", async () => {
    for (const identity of IDENTITIES.slice(0, 3)) {
      for (const override of [{ clientId: "otro" }, { tokenUse: "id" }, { expiresInSeconds: -1 }]) {
        const { handler, store } = probe({ name: "createDonation", action: "donation:create" });
        const response = await handler(eventFor(identity, override));
        expect(response.statusCode).toBe(401);
        expect(store.calls).toHaveLength(0);
      }
    }
  });

  it("sin contexto del authorizer es 401 antes de evaluar roles", async () => {
    const { handler, store } = probe({ name: "createProject", action: "project:create" });
    const response = await handler(buildJwtEvent({ authorizer: false, requestId: "r" }));
    expect(response.statusCode).toBe(401);
    expect(store.calls).toHaveLength(0);
  });
});

describe("CA-04.2: GESTOR y AUDITOR no consultan el historial de un donante", () => {
  it.each([IDENTITIES[1]!, IDENTITIES[2]!])(
    "$label → 403 (o 404) sin filtrar datos",
    async (identity) => {
      for (const name of ["listMyDonations", "getDonation"] as const) {
        const action = name === "listMyDonations" ? "donation:list-own" : "donation:read-own";
        const { handler, store } = probe({ name, action });
        const response = await handler(
          eventFor(identity, { pathParameters: { donationId: PENDING_DONATION_ID } }),
        );
        expect([403, 404]).toContain(response.statusCode);
        expect(response.body).not.toMatch(
          new RegExp(`${DONOR_A_SUB}|${PENDING_DONATION_ID}|amountCents`),
        );
        expect(store.calls).toHaveLength(0);
      }
    },
  );

  it("un GESTOR cuyo sub coincide con el del donante sigue sin acceso (el rol manda)", async () => {
    const { handler } = probe({ name: "getDonation", action: "donation:read-own" });
    const response = await handler(
      eventFor({ label: "GESTOR=donante", sub: DONOR_A_SUB, groups: ["GESTOR"] }),
    );
    expect(response.statusCode).toBe(403);
  });
});

describe("fallos tras autorizar", () => {
  it("una excepción en la lógica de negocio es 500 uniforme sin detalles", async () => {
    const handler = withAuth(
      {
        name: "x",
        action: "donation:create",
        config: { clientId: TEST_CLIENT_ID, issuer: TEST_ISSUER },
        now: () => FIXED_NOW_MS,
        createLogger: (id) => createLogger(id, { sink: () => {} }),
      },
      async () => {
        throw new Error("fallo de DynamoDB en tabla prod-Donations");
      },
    );
    const response = await handler(eventFor(IDENTITIES[0]!));
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("prod-Donations");
  });

  it.each([
    ["clientId vacío", { clientId: "", issuer: TEST_ISSUER }],
    ["emisor vacío", { clientId: TEST_CLIENT_ID, issuer: "" }],
  ])("el middleware no se puede construir con %s (falla cerrado)", (_label, config) => {
    expect(() =>
      withAuth({ name: "x", action: "donation:create", config }, async () => jsonResponse(200, {})),
    ).toThrow(TypeError);
  });
});

// --- Propiedad (BOLA) -------------------------------------------------------------------------

type DonationRow = Record<string, unknown>;
/** Sonda de "leer donación": lee el recurso persistido y aplica propiedad con `authorizeOwned`. */
function donationProbe(read: (donationId: string) => Promise<DonationRow | undefined>) {
  return withAuth(
    {
      name: "getDonation",
      action: "donation:read-own",
      config: { clientId: TEST_CLIENT_ID, issuer: TEST_ISSUER },
      now: () => FIXED_NOW_MS,
      createLogger: (id) => createLogger(id, { sink: () => {} }),
    },
    async ({ event, principal }) => {
      const donation = await read(String(event.pathParameters?.donationId));
      authorizeOwned(principal, "donation:read-own", donation);
      const { donorSub: _omit, ...publicFields } = donation!;
      return jsonResponse(200, publicFields);
    },
  );
}

function suiteBola(makeReader: () => (id: string) => Promise<DonationRow | undefined>) {
  const handler = () => donationProbe(makeReader());
  const asDonor = (sub: string, id: string) =>
    handler()(
      eventFor({ label: "d", sub, groups: ["DONANTE"] }, { pathParameters: { donationId: id } }),
    );

  it("el propietario ve su donación (sin exponer donorSub)", async () => {
    const response = await asDonor(DONOR_A_SUB, PENDING_DONATION_ID);
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("donorSub");
    expect(JSON.parse(response.body as string).donationId).toBe(PENDING_DONATION_ID);
  });

  it("la donación de otro donante responde 404 sin revelar ningún campo del registro (CA-07.2)", async () => {
    const response = await asDonor(DONOR_A_SUB, OTHER_DONOR_DONATION_ID);
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toMatch(
      new RegExp(`${OTHER_DONOR_DONATION.amountCents}|${DONOR_B_SUB}|${PUBLISHED_PROJECT_ID}`),
    );
  });

  it("una donación inexistente responde exactamente lo mismo que una ajena (no se revela existencia)", async () => {
    const foreign = await asDonor(DONOR_A_SUB, OTHER_DONOR_DONATION_ID);
    const missing = await asDonor(DONOR_A_SUB, "00000000-0000-4000-8000-0000000000ee");
    expect(missing).toEqual(foreign);
  });

  it("la relación es simétrica: el otro donante ve la suya y no la primera", async () => {
    expect((await asDonor(DONOR_B_SUB, OTHER_DONOR_DONATION_ID)).statusCode).toBe(200);
    expect((await asDonor(DONOR_B_SUB, PENDING_DONATION_ID)).statusCode).toBe(404);
  });

  it("el id sale de la ruta; un donorSub en el cuerpo o la query no concede acceso a lo ajeno", async () => {
    const response = await handler()(
      eventFor(IDENTITIES[0]!, {
        pathParameters: { donationId: OTHER_DONOR_DONATION_ID },
        body: { donorSub: DONOR_B_SUB },
        query: { donorSub: DONOR_B_SUB },
      }),
    );
    expect(response.statusCode).toBe(404);
  });

  it("un GESTOR o AUDITOR recibe 403 aunque la donación exista", async () => {
    for (const identity of [IDENTITIES[1]!, IDENTITIES[2]!]) {
      const response = await handler()(
        eventFor(identity, { pathParameters: { donationId: PENDING_DONATION_ID } }),
      );
      expect(response.statusCode).toBe(403);
    }
  });
}

describe("propiedad de recursos (almacén en memoria)", () => {
  suiteBola(() => {
    const rows = new Map<string, DonationRow>(
      [
        PENDING_DONATION,
        OTHER_DONOR_DONATION,
        makeDonation({ donationId: CONFIRMED_DONATION_ID }),
      ].map((d) => [d.donationId, { ...d }]),
    );
    return async (id) => rows.get(id);
  });
});

describe.skipIf(!hasLocalDynamo())(
  "propiedad de recursos (DynamoDB Local, datos persistidos)",
  () => {
    const config = isolatedConfig("authz");
    const { raw, doc } = hasLocalDynamo()
      ? createLocalClients()
      : ({} as ReturnType<typeof createLocalClients>);

    beforeAll(async () => {
      await resetTables(raw, config);
      for (const donation of [PENDING_DONATION, OTHER_DONOR_DONATION]) {
        await doc.send(new PutCommand({ TableName: config.tables.donations, Item: donation }));
      }
    });

    suiteBola(() => async (id) => {
      const output = await doc.send(
        new GetCommand({
          TableName: config.tables.donations,
          Key: { donationId: id },
          ConsistentRead: true,
        }),
      );
      return output.Item as DonationRow | undefined;
    });
  },
);
