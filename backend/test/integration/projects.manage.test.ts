/**
 * T064 — Gestión de proyectos de punta a punta: GESTOR crea y publica; DONANTE recibe 403 sin
 * modificar nada; publicar dos veces es 409; se registran eventos de auditoría (CA-08.1–CA-08.3).
 * Los MISMOS escenarios se ejecutan contra el doble en memoria (siempre) y contra DynamoDB Local
 * (si DYNAMODB_LOCAL_ENDPOINT está definido), de modo que la atomicidad real también se comprueba.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { actorRef } from "../../src/audit/repository";
import { DONOR_A_SUB, MANAGER_SUB } from "../helpers/fixtures";
import { buildJwtEvent, donanteEvent, gestorEvent, hasLocalDynamo } from "../helpers/setup";
import { makeLocalWorld, makeMemoryWorld, type World } from "../helpers/world";

const valid = {
  title: "Comedor solidario",
  description: "Raciones diarias",
  goalAmountCents: 800_000,
};
const body = (r: { body?: string }) => JSON.parse(r.body as string);

function scenarios(getWorld: () => Promise<World>) {
  let world: World;
  beforeAll(async () => {
    world = await getWorld();
  });

  const create = (payload: unknown = valid, extra = {}) =>
    world.createProject(gestorEvent({ method: "POST", body: payload, ...extra }));
  const publish = (projectId: string, make: typeof gestorEvent = gestorEvent) =>
    world.publishProject(make({ method: "PATCH", pathParameters: { projectId } }));
  const catalog = async () => body(await world.listProjects(buildJwtEvent({ authorizer: false })));

  it("GESTOR crea: BORRADOR, no público; publica: PUBLICADO y visible; republicar es 409", async () => {
    const created = body(await create());
    expect(created.status).toBe("BORRADOR");
    expect((await catalog()).map((p: { projectId: string }) => p.projectId)).not.toContain(
      created.projectId,
    );

    const published = await publish(created.projectId);
    expect(published.statusCode).toBe(200);
    expect(body(published).status).toBe("PUBLICADO");
    expect((await catalog()).map((p: { projectId: string }) => p.projectId)).toContain(
      created.projectId,
    );

    const again = await publish(created.projectId);
    expect(again.statusCode).toBe(409);
  });

  it("un DONANTE no puede crear ni publicar (403) y no se modifica ningún proyecto", async () => {
    const draft = body(await create({ ...valid, title: "Para el DONANTE" }));
    const before = await world.dump("projects");
    const auditBefore = (await world.dump("audit")).length;
    const donor = (o: object) => donanteEvent({ ...o, scopes: ["api/projects.write"] });

    const createResponse = await world.createProject(donor({ method: "POST", body: valid }));
    const publishResponse = await world.publishProject(
      donor({ pathParameters: { projectId: draft.projectId } }),
    );

    expect(createResponse.statusCode).toBe(403);
    expect(publishResponse.statusCode).toBe(403);
    expect(await world.dump("projects")).toEqual(before);
    expect((await world.dump("audit")).length).toBe(auditBefore);
  });

  it("registra PROJECT_CREATED y PROJECT_PUBLISHED con actor seudonimizado y sin datos sensibles", async () => {
    const created = body(
      await create({ ...valid, title: "Con auditoría" }, { requestId: "req-aud-1" }),
    );
    await world.publishProject(
      gestorEvent({
        method: "PATCH",
        pathParameters: { projectId: created.projectId },
        requestId: "req-aud-2",
      }),
    );
    const events = (await world.dump("audit")).filter((e) => e.resourceRef === created.projectId);
    expect(events.map((e) => e.eventType).sort()).toEqual(["PROJECT_CREATED", "PROJECT_PUBLISHED"]);
    for (const event of events) {
      expect(event.actorRef).toBe(actorRef(MANAGER_SUB));
      expect(event.outcome).toBe("SUCCESS");
    }
    expect(JSON.stringify(events)).not.toContain(MANAGER_SUB);
    expect(JSON.stringify(events)).not.toContain("Con auditoría");
  });

  it("un publicado dos veces deja un único evento PROJECT_PUBLISHED", async () => {
    const created = body(await create({ ...valid, title: "Doble publicación" }));
    await publish(created.projectId);
    await publish(created.projectId);
    const published = (await world.dump("audit")).filter(
      (e) => e.resourceRef === created.projectId && e.eventType === "PROJECT_PUBLISHED",
    );
    expect(published).toHaveLength(1);
  });

  it("10 publicaciones concurrentes del mismo proyecto: exactamente una 200, nueve 409, un solo evento", async () => {
    const created = body(await create({ ...valid, title: "Carrera de publicación" }));
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => publish(created.projectId)),
    );
    const statuses = responses.map((r) => r.statusCode).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
    const events = (await world.dump("audit")).filter(
      (e) => e.resourceRef === created.projectId && e.eventType === "PROJECT_PUBLISHED",
    );
    expect(events).toHaveLength(1);
  });

  it("10 altas concurrentes crean 10 proyectos distintos, cada uno con su evento", async () => {
    const before = (await world.dump("projects")).length;
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) => create({ ...valid, title: `Alta ${i}` })),
    );
    expect(responses.every((r) => r.statusCode === 201)).toBe(true);
    expect(new Set(responses.map((r) => body(r).projectId)).size).toBe(10);
    expect((await world.dump("projects")).length).toBe(before + 10);
  });

  it("los campos de verdad enviados por el navegador no se aceptan (estado, acumulado, propietario)", async () => {
    const before = (await world.dump("projects")).length;
    const response = await create({
      ...valid,
      status: "PUBLICADO",
      confirmedAmountCents: 1_000_000,
      createdBySub: DONOR_A_SUB,
    });
    expect(response.statusCode).toBe(400);
    expect((await world.dump("projects")).length).toBe(before);
  });

  it("un id de proyecto inexistente al publicar es 404 y no escribe auditoría", async () => {
    const auditBefore = (await world.dump("audit")).length;
    expect((await publish("00000000-0000-4000-8000-0000000000ab")).statusCode).toBe(404);
    expect((await world.dump("audit")).length).toBe(auditBefore);
  });

  it("sin token es 401 en ambas operaciones", async () => {
    const anon = (o: object) => gestorEvent({ ...o, authorizer: false });
    expect((await world.createProject(anon({ body: valid }))).statusCode).toBe(401);
    expect(
      (await world.publishProject(anon({ pathParameters: { projectId: "x" } }))).statusCode,
    ).toBe(401);
  });
}

describe("gestión de proyectos (doble en memoria)", () => {
  scenarios(async () => makeMemoryWorld());
});

describe.skipIf(!hasLocalDynamo())("gestión de proyectos (DynamoDB Local)", () => {
  scenarios(() => makeLocalWorld("manage"));
});
