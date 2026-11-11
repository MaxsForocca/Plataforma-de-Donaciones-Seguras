/**
 * T061 — Alta y publicación de proyectos: validación de entrada (título 1–120, descripción 1–2000,
 * objetivo entero > 0), estado inicial BORRADOR, el cliente nunca fija estado/acumulado/propietario,
 * transacciones con condición y auditoría en la misma operación (CA-08.1, CA-08.2, CA-08.3).
 */
import { PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";
import { actorRef } from "../../../src/audit/repository";
import { createProjectsWriteRepository } from "../../../src/projects/repository";
import { AppError } from "../../../src/shared/http";
import { createFakeTables } from "../../helpers/fakeTables";
import {
  DRAFT_PROJECT,
  DRAFT_PROJECT_ID,
  MANAGER_SUB,
  MISSING_PROJECT_ID,
  PUBLISHED_PROJECT,
  PUBLISHED_PROJECT_ID,
  DONOR_B_SUB,
} from "../../helpers/fixtures";
import { buildJwtEvent, createRecordingClient, gestorEvent, testConfig } from "../../helpers/setup";
import { makeMemoryWorld } from "../../helpers/world";

const valid = {
  title: "Biblioteca comunitaria",
  description: "Libros para todos",
  goalAmountCents: 500_000,
};
const create = (world = makeMemoryWorld(), body: unknown = valid, extra = {}) =>
  world.createProject(gestorEvent({ method: "POST", path: "/v1/projects", body, ...extra }));
const publish = (world: ReturnType<typeof makeMemoryWorld>, projectId: string, extra = {}) =>
  world.publishProject(
    gestorEvent({
      method: "PATCH",
      path: `/v1/projects/${projectId}/publish`,
      pathParameters: { projectId },
      ...extra,
    }),
  );
const parsed = (response: { body?: string }) => JSON.parse(response.body as string);

describe("validación de la creación (400, sin escrituras)", () => {
  const rejected: [string, unknown][] = [
    ["título vacío", { ...valid, title: "" }],
    ["título solo espacios", { ...valid, title: "   " }],
    ["título de 121 caracteres", { ...valid, title: "a".repeat(121) }],
    ["título con HTML", { ...valid, title: "<b>x</b>" }],
    ["título no texto", { ...valid, title: 123 }],
    ["descripción vacía", { ...valid, description: "" }],
    ["descripción de 2001 caracteres", { ...valid, description: "a".repeat(2001) }],
    ["descripción con <script>", { ...valid, description: "<script>alert(1)</script>" }],
    ["objetivo 0", { ...valid, goalAmountCents: 0 }],
    ["objetivo negativo", { ...valid, goalAmountCents: -1 }],
    ["objetivo decimal", { ...valid, goalAmountCents: 100.5 }],
    ["objetivo como texto", { ...valid, goalAmountCents: "500000" }],
    ["objetivo nulo", { ...valid, goalAmountCents: null }],
    ["objetivo booleano", { ...valid, goalAmountCents: true }],
    ["objetivo arreglo", { ...valid, goalAmountCents: [500000] }],
    ["objetivo enorme (1e21)", { ...valid, goalAmountCents: 1e21 }],
    ["objetivo no seguro (2^53)", { ...valid, goalAmountCents: 2 ** 53 }],
    ["falta el título", { description: valid.description, goalAmountCents: 1 }],
    ["falta la descripción", { title: valid.title, goalAmountCents: 1 }],
    ["falta el objetivo", { title: valid.title, description: valid.description }],
    ["cuerpo vacío {}", {}],
    ["cuerpo arreglo", []],
    ["cuerpo null", null],
    ["cuerpo número", 42],
    ["cuerpo texto", "hola"],
  ];

  it.each(rejected)("%s → 400 y no se escribe nada", async (_label, body) => {
    const world = makeMemoryWorld();
    const response = await create(world, body);
    expect(response.statusCode).toBe(400);
    expect(parsed(response).code).toMatch(/INVALID_REQUEST|INVALID_AMOUNT/);
    expect(world.calls()).toHaveLength(0);
    expect(await world.dump("projects")).toHaveLength(0);
  });

  it.each(["{", "no es json", "", "{'a':1}", '{"title":"x",}'])(
    "cuerpo no JSON (%j) → 400",
    async (rawBody) => {
      const world = makeMemoryWorld();
      const response = await world.createProject(gestorEvent({ rawBody }));
      expect(response.statusCode).toBe(400);
      expect(world.calls()).toHaveLength(0);
    },
  );

  it("sin cuerpo → 400", async () => {
    const world = makeMemoryWorld();
    expect((await world.createProject(gestorEvent())).statusCode).toBe(400);
  });

  it("un cuerpo de más de 16 KiB → 400", async () => {
    const world = makeMemoryWorld();
    const response = await create(world, { ...valid, description: "a".repeat(20_000) });
    expect(response.statusCode).toBe(400);
  });

  it("el 400 no revela el campo ni el valor rechazado", async () => {
    const response = await create(makeMemoryWorld(), { ...valid, goalAmountCents: -777 });
    expect(response.body).not.toMatch(/goalAmountCents|-777|too_small/);
  });

  describe("el cliente no impone estado, acumulado, propietario ni identificadores", () => {
    it.each([
      ["status PUBLICADO", { status: "PUBLICADO" }],
      ["status BORRADOR", { status: "BORRADOR" }],
      ["confirmedAmountCents", { confirmedAmountCents: 999_999 }],
      ["createdBySub", { createdBySub: DONOR_B_SUB }],
      ["projectId", { projectId: PUBLISHED_PROJECT_ID }],
      ["currency", { currency: "USD" }],
      ["createdAt", { createdAt: "2000-01-01T00:00:00.000Z" }],
      ["updatedAt", { updatedAt: "2000-01-01T00:00:00.000Z" }],
      ["roles", { roles: ["GESTOR"] }],
      ["donorSub", { donorSub: DONOR_B_SUB }],
    ])("el campo extra %s se rechaza (400) y no se escribe nada", async (_label, extra) => {
      const world = makeMemoryWorld();
      const response = await create(world, { ...valid, ...extra });
      expect(response.statusCode).toBe(400);
      expect(world.calls()).toHaveLength(0);
    });
  });

  describe("límites aceptados", () => {
    it.each([
      ["título de 120 caracteres", { ...valid, title: "a".repeat(120) }],
      ["descripción de 2000 caracteres", { ...valid, description: "a".repeat(2000) }],
      ["objetivo mínimo 1 céntimo", { ...valid, goalAmountCents: 1 }],
      ["objetivo máximo seguro", { ...valid, goalAmountCents: Number.MAX_SAFE_INTEGER }],
      ["texto con tildes, ñ y comillas", { ...valid, title: "Niñez & «Educación» 'rural'" }],
    ])("%s → 201", async (_label, body) => {
      expect((await create(makeMemoryWorld(), body)).statusCode).toBe(201);
    });

    it("recorta los espacios del título y la descripción", async () => {
      const response = await create(makeMemoryWorld(), {
        ...valid,
        title: "  Hola  ",
        description: "  Mundo  ",
      });
      expect(parsed(response)).toMatchObject({ title: "Hola", description: "Mundo" });
    });
  });
});

describe("estado inicial y propiedad (CA-08.1)", () => {
  it("nace en BORRADOR con acumulado 0 y moneda PEN, y no es público", async () => {
    const world = makeMemoryWorld();
    const response = await create(world);
    expect(response.statusCode).toBe(201);
    expect(parsed(response)).toMatchObject({
      status: "BORRADOR",
      confirmedAmountCents: 0,
      currency: "PEN",
      goalAmountCents: 500_000,
    });
    const listed = await world.listProjects(buildJwtEvent({ authorizer: false }));
    expect(listed.body).toBe("[]");
  });

  it("el projectId lo genera el servidor (UUID) y las fechas son ISO iguales al crear", async () => {
    const body = parsed(await create());
    expect(body.projectId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(body.updatedAt).toBe(body.createdAt);
  });

  it("dos altas idénticas crean dos proyectos distintos (el alta no es idempotente por contenido)", async () => {
    const world = makeMemoryWorld();
    const a = parsed(await create(world));
    const b = parsed(await create(world));
    expect(a.projectId).not.toBe(b.projectId);
    expect(await world.dump("projects")).toHaveLength(2);
  });

  it("el propietario (createdBySub) es el sub del token, nunca el del cuerpo, la query ni las cabeceras", async () => {
    const world = makeMemoryWorld();
    await create(world, valid, {
      query: { createdBySub: DONOR_B_SUB },
      headers: { "x-user-sub": DONOR_B_SUB, "x-created-by": DONOR_B_SUB },
    });
    const [stored] = await world.dump("projects");
    expect(stored!.createdBySub).toBe(MANAGER_SUB);
  });

  it("la respuesta pública no incluye createdBySub ni datos internos", async () => {
    const response = await create();
    expect(Object.keys(parsed(response)).sort()).toEqual(
      [
        "confirmedAmountCents",
        "createdAt",
        "currency",
        "description",
        "goalAmountCents",
        "projectId",
        "status",
        "title",
        "updatedAt",
      ].sort(),
    );
    expect(response.body).not.toContain(MANAGER_SUB);
  });

  it("los importes se guardan como enteros (tipo número, sin decimales)", async () => {
    const world = makeMemoryWorld();
    await create(world);
    const [stored] = await world.dump("projects");
    expect(Number.isInteger(stored!.goalAmountCents)).toBe(true);
    expect(stored!.confirmedAmountCents).toBe(0);
  });
});

describe("transacción de alta + auditoría (CA-08.3)", () => {
  it("una sola TransactWriteItems con Put condicionado del proyecto y el evento de auditoría", async () => {
    const world = makeMemoryWorld();
    await create(world);
    expect(world.calls().map((c) => c.name)).toEqual(["TransactWriteCommand"]);
    const items = world.calls()[0]!.input.TransactItems as { Put: Record<string, any> }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(items).toHaveLength(2);
    expect(items[0]!.Put).toMatchObject({
      TableName: "testProjects",
      ConditionExpression: "attribute_not_exists(projectId)",
    });
    expect(items[1]!.Put.TableName).toBe("testAuditEvents");
  });

  it("el evento PROJECT_CREATED registra actor seudonimizado, recurso, acción, resultado y requestId", async () => {
    const world = makeMemoryWorld();
    const body = parsed(await create(world, valid, { requestId: "req-alta-1" }));
    const [event] = await world.dump("audit");
    expect(event).toMatchObject({
      eventType: "PROJECT_CREATED",
      resourceRef: body.projectId,
      action: "createProject",
      outcome: "SUCCESS",
      requestId: "req-alta-1",
      actorRef: actorRef(MANAGER_SUB),
    });
    expect(JSON.stringify(event)).not.toContain(MANAGER_SUB);
    expect(event!.timestamp).toBeTruthy();
  });

  it("el evento no guarda el título ni la descripción (solo datos no sensibles)", async () => {
    const world = makeMemoryWorld();
    await create(world, { ...valid, title: "TITULO-SECRETO", description: "DESC-SECRETA" });
    expect(JSON.stringify(await world.dump("audit"))).not.toMatch(/SECRETO|SECRETA/);
  });

  it("si la transacción se cancela no queda ni el proyecto ni el evento (todo o nada)", async () => {
    const world = makeMemoryWorld();
    world.fake!.injectFault((call) =>
      call.name === "TransactWriteCommand"
        ? Object.assign(new Error("x"), {
            name: "TransactionCanceledException",
            CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
          })
        : undefined,
    );
    const response = await create(world);
    expect(response.statusCode).toBe(500);
    expect(await world.dump("projects")).toHaveLength(0);
    expect(await world.dump("audit")).toHaveLength(0);
  });

  it("un fallo de la base de datos es un 500 uniforme sin detalles internos", async () => {
    const client = createRecordingClient(() =>
      Object.assign(new Error("ARN arn:aws:dynamodb:..."), { name: "AccessDeniedException" }),
    );
    const repo = createProjectsWriteRepository(client, { projects: "t", audit: "a" });
    const error = await repo
      .createProject({ actorSub: MANAGER_SUB, requestId: "r", input: valid })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(500);
  });
});

describe("publicación (CA-08.2)", () => {
  const worldWith = () =>
    makeMemoryWorld({ projects: [{ ...DRAFT_PROJECT }, { ...PUBLISHED_PROJECT }] });

  it("BORRADOR → PUBLICADO: 200, estado y fecha actualizados, createdAt y acumulado intactos", async () => {
    const world = worldWith();
    const response = await publish(world, DRAFT_PROJECT_ID);
    expect(response.statusCode).toBe(200);
    const body = parsed(response);
    expect(body).toMatchObject({
      projectId: DRAFT_PROJECT_ID,
      status: "PUBLICADO",
      confirmedAmountCents: 0,
      createdAt: DRAFT_PROJECT.createdAt,
    });
    expect(body.updatedAt > DRAFT_PROJECT.updatedAt).toBe(true);
    const stored = (await world.dump("projects")).find((p) => p.projectId === DRAFT_PROJECT_ID)!;
    expect(stored.status).toBe("PUBLICADO");
    expect(stored.createdBySub).toBe(MANAGER_SUB);
  });

  it("tras publicar aparece en el catálogo público", async () => {
    const world = worldWith();
    await publish(world, DRAFT_PROJECT_ID);
    const ids = parsed(await world.listProjects(buildJwtEvent({ authorizer: false }))).map(
      (p: { projectId: string }) => p.projectId,
    );
    expect(ids).toContain(DRAFT_PROJECT_ID);
  });

  it("publicar un proyecto ya publicado → 409 y no cambia nada", async () => {
    const world = worldWith();
    const before = await world.dump("projects");
    const response = await publish(world, PUBLISHED_PROJECT_ID);
    expect(response.statusCode).toBe(409);
    expect(parsed(response).code).toBe("CONFLICT");
    expect(await world.dump("projects")).toEqual(before);
    expect(await world.dump("audit")).toHaveLength(0);
  });

  it("publicar dos veces: la primera 200 y la segunda 409", async () => {
    const world = worldWith();
    expect((await publish(world, DRAFT_PROJECT_ID)).statusCode).toBe(200);
    expect((await publish(world, DRAFT_PROJECT_ID)).statusCode).toBe(409);
    expect(await world.dump("audit")).toHaveLength(1);
  });

  it.each([
    ["inexistente", MISSING_PROJECT_ID],
    ["malformado", "no-es-uuid"],
    ["con salto de ruta", "../../x"],
    ["inyección", '{"$ne":null}'],
    ["vacío", ""],
  ])("un id %s → 404 uniforme", async (_label, id) => {
    const world = worldWith();
    const response = await publish(world, id);
    expect(response.statusCode).toBe(404);
    expect(parsed(response).code).toBe("NOT_FOUND");
    expect(await world.dump("audit")).toHaveLength(0);
  });

  it("los ids malformados ni siquiera consultan la base de datos", async () => {
    const world = worldWith();
    await publish(world, "no-es-uuid");
    expect(world.calls()).toHaveLength(0);
  });

  it("lee el proyecto con consistencia fuerte y luego usa una sola transacción condicionada", async () => {
    const world = worldWith();
    await publish(world, DRAFT_PROJECT_ID);
    const [read, tx] = world.calls();
    expect(read!.name).toBe("GetCommand");
    expect(read!.input.ConsistentRead).toBe(true);
    expect(tx!.name).toBe("TransactWriteCommand");
    const items = tx!.input.TransactItems as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(items[0]!.Update.ConditionExpression).toMatch(/attribute_exists\(projectId\)/);
    expect(items[0]!.Update.ConditionExpression).toMatch(/#status = :draft/);
    expect(items[1]!.Put.Item.eventType).toBe("PROJECT_PUBLISHED");
  });

  it("carrera: si otro publica entre la lectura y la escritura, la condición falla → 409 sin efectos", async () => {
    const world = worldWith();
    let first = true;
    world.fake!.injectFault((call) => {
      if (call.name === "TransactWriteCommand" && first) {
        first = false;
        return Object.assign(new Error("x"), {
          name: "TransactionCanceledException",
          CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
        });
      }
    });
    expect((await publish(world, DRAFT_PROJECT_ID)).statusCode).toBe(409);
    expect(await world.dump("audit")).toHaveLength(0);
  });

  it("el evento PROJECT_PUBLISHED queda registrado con el actor seudonimizado", async () => {
    const world = worldWith();
    await publish(world, DRAFT_PROJECT_ID, { requestId: "req-pub-1" });
    const [event] = await world.dump("audit");
    expect(event).toMatchObject({
      eventType: "PROJECT_PUBLISHED",
      resourceRef: DRAFT_PROJECT_ID,
      outcome: "SUCCESS",
      requestId: "req-pub-1",
      actorRef: actorRef(MANAGER_SUB),
    });
  });

  it.each([
    ["meta decimal", { goalAmountCents: 1.5 }],
    ["acumulado negativo", { confirmedAmountCents: -1 }],
    ["moneda distinta", { currency: "USD" }],
    ["título vacío", { title: "" }],
  ])(
    "un proyecto guardado con datos corruptos (%s) no se publica: 500 controlado",
    async (_label, patch) => {
      const world = makeMemoryWorld({ projects: [{ ...DRAFT_PROJECT, ...patch }] });
      const response = await publish(world, DRAFT_PROJECT_ID);
      expect(response.statusCode).toBe(500);
      expect((await world.dump("projects"))[0]!.status).toBe("BORRADOR");
    },
  );

  it("un estado desconocido en la base de datos tampoco se publica", async () => {
    const world = makeMemoryWorld({ projects: [{ ...DRAFT_PROJECT, status: "ARCHIVADO" }] });
    expect([409, 500]).toContain((await publish(world, DRAFT_PROJECT_ID)).statusCode);
    expect((await world.dump("projects"))[0]!.status).toBe("ARCHIVADO");
  });

  it("repositorio: el cuerpo de la solicitud o la query no influyen (el id sale de la ruta)", async () => {
    const world = worldWith();
    const response = await publish(world, DRAFT_PROJECT_ID, {
      body: { projectId: PUBLISHED_PROJECT_ID, status: "BORRADOR" },
      query: { projectId: PUBLISHED_PROJECT_ID },
    });
    expect(parsed(response).projectId).toBe(DRAFT_PROJECT_ID);
  });
});

describe("conjunto de comandos de escritura", () => {
  it("el repositorio solo emite TransactWrite y GetItem (nunca Put/Update/Delete sueltos)", async () => {
    const world = makeMemoryWorld({ projects: [{ ...DRAFT_PROJECT }] });
    await create(world);
    await publish(world, DRAFT_PROJECT_ID);
    const names = new Set(world.calls().map((c) => c.name));
    expect([...names].sort()).toEqual(["GetCommand", "TransactWriteCommand"]);
    expect(world.calls().some((c) => c.name === PutCommand.name)).toBe(false);
    expect(TransactWriteCommand.name).toBe("TransactWriteCommand");
  });

  it("el doble de tablas reproduce la cancelación atómica (comprobación del propio doble)", async () => {
    const fake = createFakeTables(testConfig(), { projects: [{ ...PUBLISHED_PROJECT }] });
    const error = await fake.client
      .send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: "testAuditEvents",
                Item: { eventType: "X", sk: "1" },
                ConditionExpression: "attribute_not_exists(eventType)",
              },
            },
            {
              Put: {
                TableName: "testProjects",
                Item: { ...PUBLISHED_PROJECT },
                ConditionExpression: "attribute_not_exists(projectId)",
              },
            },
          ],
        }) as never,
      )
      .catch((e: unknown) => e);
    expect((error as { name: string }).name).toBe("TransactionCanceledException");
    expect(fake.dump("audit")).toHaveLength(0); // el primer Put no se aplicó
  });
});
