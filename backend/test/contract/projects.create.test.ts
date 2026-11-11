/**
 * T062 — Contrato de `POST /v1/projects`: 201 con un proyecto en BORRADOR, 400, 401 y 403 (CA-08.1,
 * CA-04.1). Se ejecuta el handler REAL (con el middleware de authz) contra el doble de tablas y se
 * compara con contracts/openapi.yaml. La matriz genérica de roles ya vive en authz.roles.test.ts y
 * authz.errors.test.ts; aquí solo se comprueba el cableado de esta operación.
 */
import {
  DESCRIPTION_MAX_LENGTH,
  errorEnvelopeSchema,
  projectCreateRequestSchema,
  projectSchema,
  TITLE_MAX_LENGTH,
} from "@donaciones/shared";
import { describe, expect, it } from "vitest";
import { ACTIONS } from "../../src/authz/policies";
import { DONOR_A_SUB } from "../helpers/fixtures";
import { loadOpenApi } from "../helpers/openapi";
import { auditorEvent, buildJwtEvent, donanteEvent, gestorEvent } from "../helpers/setup";
import { makeMemoryWorld } from "../helpers/world";

const valid = { title: "Biblioteca", description: "Libros", goalAmountCents: 500_000 };
const post = (world: ReturnType<typeof makeMemoryWorld>, event = gestorEvent({ body: valid })) =>
  world.createProject({
    ...event,
    requestContext: { ...event.requestContext, requestId: "req-c" },
  });
const body = (response: { body?: string }) => JSON.parse(response.body as string);

describe("POST /v1/projects → 201", () => {
  it("devuelve el proyecto en BORRADOR con el esquema Project y cabeceras seguras", async () => {
    const response = await post(makeMemoryWorld());
    expect(response.statusCode).toBe(201);
    expect(response.headers).toMatchObject({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    const project = body(response);
    expect(projectSchema.safeParse(project).success).toBe(true);
    expect(project.status).toBe("BORRADOR");
  });

  it("no es visible en el catálogo público mientras está en BORRADOR", async () => {
    const world = makeMemoryWorld();
    await post(world);
    expect((await world.listProjects(buildJwtEvent({ authorizer: false }))).body).toBe("[]");
  });
});

describe("POST /v1/projects → 400", () => {
  it.each([
    ["objetivo no entero", { ...valid, goalAmountCents: 1.5 }],
    ["campo extra no permitido", { ...valid, status: "PUBLICADO" }],
    ["falta un campo", { title: "x" }],
  ])("%s → 400 con el sobre uniforme", async (_label, payload) => {
    const response = await post(makeMemoryWorld(), gestorEvent({ body: payload }));
    expect(response.statusCode).toBe(400);
    const envelope = body(response);
    expect(errorEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(envelope.requestId).toBe("req-c");
  });
});

describe("POST /v1/projects → 401 y 403", () => {
  const denied: [string, ReturnType<typeof gestorEvent>, number][] = [
    ["sin token", gestorEvent({ authorizer: false, body: valid }), 401],
    ["ID token", gestorEvent({ tokenUse: "id", body: valid }), 401],
    ["token vencido", gestorEvent({ expiresInSeconds: -1, body: valid }), 401],
    ["token de otro cliente", gestorEvent({ clientId: "otro", body: valid }), 401],
    [
      "DONANTE",
      donanteEvent({ body: valid, scopes: ["api/projects.write", "api/donations.write"] }),
      403,
    ],
    ["AUDITOR", auditorEvent({ body: valid, scopes: ["api/projects.write"] }), 403],
    ["sin grupos", gestorEvent({ groups: null, body: valid }), 403],
    ["GESTOR sin el scope", gestorEvent({ scopes: ["api/donations.read"], body: valid }), 403],
  ];

  it.each(denied)("%s → HTTP %i, sin escrituras", async (_label, event, status) => {
    const world = makeMemoryWorld();
    const response = await post(world, event);
    expect(response.statusCode).toBe(status);
    expect(errorEnvelopeSchema.safeParse(body(response)).success).toBe(true);
    expect(world.calls()).toHaveLength(0);
    expect(await world.dump("projects")).toHaveLength(0);
  });

  it("la autorización va ANTES que la validación: un DONANTE con cuerpo inválido recibe 403, no 400", async () => {
    const world = makeMemoryWorld();
    const response = await post(
      world,
      donanteEvent({ body: { basura: true }, scopes: ["api/projects.write"] }),
    );
    expect(response.statusCode).toBe(403);
  });

  it("sin token y con cuerpo inválido es 401, no 400", async () => {
    const response = await post(
      makeMemoryWorld(),
      gestorEvent({ authorizer: false, rawBody: "{" }),
    );
    expect(response.statusCode).toBe(401);
  });

  it("un DONANTE que se declara GESTOR en cuerpo, query o cabeceras sigue recibiendo 403", async () => {
    const world = makeMemoryWorld();
    const response = await post(
      world,
      donanteEvent({
        scopes: ["api/projects.write"],
        body: { ...valid, roles: ["GESTOR"], groups: ["GESTOR"] },
        query: { role: "GESTOR" },
        headers: { "x-user-groups": "GESTOR" },
      }),
    );
    expect(response.statusCode).toBe(403);
    expect(world.calls()).toHaveLength(0);
  });

  it("los 401 son idénticos entre sí y los 403 también (no se revela la causa)", async () => {
    const world = makeMemoryWorld();
    const bodies = async (status: number) =>
      new Set(
        await Promise.all(
          denied
            .filter(([, , s]) => s === status)
            .map(async ([, e]) => (await post(world, e)).body),
        ),
      );
    expect((await bodies(401)).size).toBe(1);
    expect((await bodies(403)).size).toBe(1);
  });

  it("el 401 incluye WWW-Authenticate: Bearer", async () => {
    const response = await post(makeMemoryWorld(), gestorEvent({ authorizer: false, body: valid }));
    expect(response.headers?.["www-authenticate"]).toBe("Bearer");
  });

  it("no filtra el sub del donante ni de nadie en los rechazos", async () => {
    const response = await post(
      makeMemoryWorld(),
      donanteEvent({ sub: DONOR_A_SUB, body: valid, scopes: ["api/projects.write"] }),
    );
    expect(response.body).not.toContain(DONOR_A_SUB);
  });
});

describe("coincide con contracts/openapi.yaml", () => {
  const openapi = loadOpenApi();
  const operation = openapi.paths["/v1/projects"]!.post as unknown as {
    security: Record<string, string[]>[];
    "x-required-group": string;
    responses: Record<string, unknown>;
  };

  it("declara 201, 400, 401, 403 y 500; exige GESTOR y el scope de la política", () => {
    expect(Object.keys(operation.responses).sort()).toEqual(["201", "400", "401", "403", "500"]);
    expect(operation["x-required-group"]).toBe("GESTOR");
    expect(operation.security).toEqual([{ cognitoOAuth: [ACTIONS["project:create"].scope] }]);
  });

  it("ProjectCreateRequest: mismas propiedades y límites que el esquema del backend, sin campos extra", () => {
    const request = openapi.components.schemas.ProjectCreateRequest!;
    expect(request.additionalProperties).toBe(false);
    expect([...request.required!].sort()).toEqual(
      Object.keys(projectCreateRequestSchema.shape).sort(),
    );
    const props = request.properties as Record<string, Record<string, unknown>>;
    expect(props.title).toMatchObject({ minLength: 1, maxLength: TITLE_MAX_LENGTH });
    expect(props.description).toMatchObject({ minLength: 1, maxLength: DESCRIPTION_MAX_LENGTH });
    expect(props.goalAmountCents).toMatchObject({ type: "integer", minimum: 1 });
  });

  it("el cuerpo de la respuesta tiene exactamente las propiedades del esquema Project", async () => {
    const project = body(await post(makeMemoryWorld()));
    const schema = openapi.components.schemas.Project!;
    expect(Object.keys(schema.properties!).sort()).toEqual(Object.keys(project).sort());
    expect([...schema.required!].sort()).toEqual(Object.keys(project).sort());
  });
});
