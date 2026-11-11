/**
 * T034 — Catálogo público: mapeo y filtrado de solo PUBLICADO (CA-01.1, CA-01.2, CA-01.3, CA-09.2).
 */
import { describe, expect, it, vi } from "vitest";
import { createListProjectsHandler } from "../../../src/projects/handlers/listProjects";
import { createProjectsRepository } from "../../../src/projects/repository";
import { AppError } from "../../../src/shared/http";
import { createLogger } from "../../../src/shared/logger";
import {
  DRAFT_PROJECT,
  DRAFT_PROJECT_ID,
  makeProject,
  PUBLISHED_PROJECT,
  PUBLISHED_PROJECT_ID,
} from "../../helpers/fixtures";
import { createFakeProjectsDynamo } from "../../helpers/fakeDynamo";
import { buildJwtEvent, createRecordingClient } from "../../helpers/setup";

const TABLE = "testProjects";
const repoOver = (items: readonly object[], pageSize?: number) => {
  const client = createFakeProjectsDynamo(items, { pageSize });
  return { client, repository: createProjectsRepository(client, TABLE) };
};

const SECOND_PUBLISHED = makeProject({
  projectId: "00000000-0000-4000-8000-000000000009",
  title: "Comedor solidario",
  createdAt: "2026-11-02T10:00:00.000Z",
  updatedAt: "2026-11-02T10:00:00.000Z",
});

describe("repository.listPublished — consulta", () => {
  it("consulta el GSI status-createdAt de la tabla Projects con status = PUBLICADO", async () => {
    const { client, repository } = repoOver([PUBLISHED_PROJECT]);
    await repository.listPublished();

    expect(client.calls).toHaveLength(1);
    const call = client.calls[0]!;
    expect(call.name).toBe("QueryCommand");
    expect(call.input.TableName).toBe(TABLE);
    expect(call.input.IndexName).toBe("status-createdAt");
    expect(Object.values(call.input.ExpressionAttributeValues)).toEqual(["PUBLICADO"]);
  });

  it("ordena del más reciente al más antiguo", async () => {
    const { client, repository } = repoOver([PUBLISHED_PROJECT, SECOND_PUBLISHED]);
    const result = await repository.listPublished();
    expect(client.calls[0]!.input.ScanIndexForward).toBe(false);
    expect(result.map((p) => p.projectId)).toEqual([
      SECOND_PUBLISHED.projectId,
      PUBLISHED_PROJECT_ID,
    ]);
  });

  it("no pide ConsistentRead (los índices secundarios globales no lo admiten)", async () => {
    const { client, repository } = repoOver([PUBLISHED_PROJECT]);
    await repository.listPublished();
    expect(client.calls[0]!.input.ConsistentRead).toBeUndefined();
  });

  it("proyecta solo los atributos públicos: nunca createdBySub ni fechas internas", async () => {
    const { client, repository } = repoOver([PUBLISHED_PROJECT]);
    await repository.listPublished();
    const names = Object.values(client.calls[0]!.input.ExpressionAttributeNames) as string[];
    expect(names).not.toContain("createdBySub");
    expect(names.sort()).toEqual(
      [
        "confirmedAmountCents",
        "currency",
        "description",
        "goalAmountCents",
        "projectId",
        "status",
        "title",
      ].sort(),
    );
  });

  it("usa alias para todos los atributos (status y otros pueden ser palabras reservadas)", async () => {
    const { client, repository } = repoOver([PUBLISHED_PROJECT]);
    await repository.listPublished();
    const input = client.calls[0]!.input;
    expect(input.KeyConditionExpression).toMatch(/^#\w+ = :s$/);
    expect(input.ProjectionExpression).toMatch(/^#\w+(, #\w+)*$/);
  });

  it("solo envía comandos de lectura (nunca Put/Update/Delete/Transact)", async () => {
    const { client, repository } = repoOver([PUBLISHED_PROJECT, DRAFT_PROJECT]);
    await repository.listPublished();
    expect(client.calls.map((c) => c.name)).toEqual(["QueryCommand"]);
  });
});

describe("repository.listPublished — mapeo (CA-01.1)", () => {
  it("devuelve nombre, finalidad, meta y suma confirmada en céntimos enteros, en PEN", async () => {
    const { repository } = repoOver([PUBLISHED_PROJECT]);
    expect(await repository.listPublished()).toEqual([
      {
        projectId: PUBLISHED_PROJECT_ID,
        title: "Biblioteca comunitaria",
        description: "Proyecto ficticio de pruebas.",
        goalAmountCents: 500_000,
        confirmedAmountCents: 10_000,
        currency: "PEN",
      },
    ]);
  });

  it("conserva los importes exactos, sin conversión de punto flotante", async () => {
    const huge = makeProject({ goalAmountCents: 9_007_199_254_740_991, confirmedAmountCents: 1 });
    const { repository } = repoOver([huge]);
    const [project] = await repository.listPublished();
    expect(project!.goalAmountCents).toBe(Number.MAX_SAFE_INTEGER);
    expect(Number.isInteger(project!.confirmedAmountCents)).toBe(true);
  });

  it("no expone atributos internos aunque la base de datos los devuelva", async () => {
    const leaky = {
      ...PUBLISHED_PROJECT,
      donorSub: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      donations: [{ donationId: "x", donorSub: "y" }],
      idempotencyKey: "k",
    };
    // El doble respeta la proyección, por lo que se usa un cliente que ignora ProjectionExpression.
    const client = createRecordingClient(() => ({ Items: [leaky] }));
    const [project] = await createProjectsRepository(client, TABLE).listPublished();
    expect(Object.keys(project!).sort()).toEqual(
      [
        "confirmedAmountCents",
        "currency",
        "description",
        "goalAmountCents",
        "projectId",
        "title",
      ].sort(),
    );
    expect(JSON.stringify(project)).not.toMatch(/donor|createdBySub|donations|idempotency/i);
  });

  it("un catálogo sin proyectos publicados devuelve una lista vacía (CA-01.3)", async () => {
    const { repository } = repoOver([DRAFT_PROJECT]);
    expect(await repository.listPublished()).toEqual([]);
    expect(
      await createProjectsRepository(createFakeProjectsDynamo([]), TABLE).listPublished(),
    ).toEqual([]);
  });

  it("tolera una respuesta sin Items", async () => {
    const client = createRecordingClient(() => ({}));
    expect(await createProjectsRepository(client, TABLE).listPublished()).toEqual([]);
  });
});

describe("repository.listPublished — los borradores nunca aparecen (CA-01.2)", () => {
  it("excluye los BORRADOR de la consulta", async () => {
    const { repository } = repoOver([DRAFT_PROJECT, PUBLISHED_PROJECT]);
    const ids = (await repository.listPublished()).map((p) => p.projectId);
    expect(ids).toEqual([PUBLISHED_PROJECT_ID]);
    expect(ids).not.toContain(DRAFT_PROJECT_ID);
  });

  it("defensa en profundidad: si el índice devolviera un BORRADOR, se descarta igualmente", async () => {
    const client = createRecordingClient(() => ({ Items: [DRAFT_PROJECT, PUBLISHED_PROJECT] }));
    const result = await createProjectsRepository(client, TABLE).listPublished();
    expect(result.map((p) => p.projectId)).toEqual([PUBLISHED_PROJECT_ID]);
  });

  it.each([
    ["sin estado", { ...PUBLISHED_PROJECT, status: undefined }],
    ["estado vacío", { ...PUBLISHED_PROJECT, status: "" }],
    ["estado en minúsculas", { ...PUBLISHED_PROJECT, status: "publicado" }],
    ["estado desconocido", { ...PUBLISHED_PROJECT, status: "ARCHIVADO" }],
    ["estado BORRADOR", { ...PUBLISHED_PROJECT, status: "BORRADOR" }],
    ["estado numérico", { ...PUBLISHED_PROJECT, status: 1 }],
  ])("descarta un item %s", async (_label, item) => {
    const client = createRecordingClient(() => ({ Items: [item, PUBLISHED_PROJECT] }));
    const result = await createProjectsRepository(client, TABLE).listPublished();
    expect(result).toHaveLength(1);
  });

  it("con varios borradores y publicados mezclados, solo salen los publicados", async () => {
    const drafts = Array.from({ length: 10 }, (_, i) =>
      makeProject({
        projectId: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`,
        status: "BORRADOR",
      }),
    );
    const client = createRecordingClient(() => ({
      Items: [...drafts, PUBLISHED_PROJECT, SECOND_PUBLISHED],
    }));
    const result = await createProjectsRepository(client, TABLE).listPublished();
    expect(result).toHaveLength(2);
  });
});

describe("repository.listPublished — paginación interna de DynamoDB", () => {
  it("recorre todas las páginas hasta agotar LastEvaluatedKey", async () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      makeProject({
        projectId: `00000000-0000-4000-8000-0000000002${String(i).padStart(2, "0")}`,
        createdAt: `2026-11-0${i + 1}T10:00:00.000Z`,
      }),
    );
    const { client, repository } = repoOver(many, 2);
    const result = await repository.listPublished();
    expect(result).toHaveLength(5);
    expect(client.calls).toHaveLength(3);
    expect(client.calls[1]!.input.ExclusiveStartKey).toBeDefined();
    expect(new Set(result.map((p) => p.projectId)).size).toBe(5);
  });

  it("corta un LastEvaluatedKey infinito con un error controlado (no se cuelga)", async () => {
    const client = createRecordingClient(() => ({
      Items: [PUBLISHED_PROJECT],
      LastEvaluatedKey: { projectId: "x" },
    }));
    const promise = createProjectsRepository(client, TABLE).listPublished();
    await expect(promise).rejects.toMatchObject({ statusCode: 500, code: "INTERNAL_ERROR" });
    expect(client.calls.length).toBeLessThanOrEqual(20);
  });
});

describe("repository.listPublished — integridad de los importes (principio III)", () => {
  it.each([
    ["meta decimal", { goalAmountCents: 100.5 }],
    ["meta cero", { goalAmountCents: 0 }],
    ["meta negativa", { goalAmountCents: -1 }],
    ["meta como texto", { goalAmountCents: "5000" }],
    ["acumulado decimal", { confirmedAmountCents: 0.5 }],
    ["acumulado negativo", { confirmedAmountCents: -1 }],
    ["acumulado como texto", { confirmedAmountCents: "0" }],
    ["acumulado NaN", { confirmedAmountCents: Number.NaN }],
    ["moneda distinta de PEN", { currency: "USD" }],
    ["título vacío", { title: "" }],
    ["projectId inválido", { projectId: "no-es-uuid" }],
  ])("falla de forma controlada (500) ante datos corruptos: %s", async (_label, patch) => {
    const client = createRecordingClient(() => ({ Items: [{ ...PUBLISHED_PROJECT, ...patch }] }));
    const error = await createProjectsRepository(client, TABLE)
      .listPublished()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(500);
  });

  it("no publica silenciosamente un catálogo parcial: un item corrupto hace fallar la lectura", async () => {
    const client = createRecordingClient(() => ({
      Items: [PUBLISHED_PROJECT, { ...SECOND_PUBLISHED, goalAmountCents: 1.5 }],
    }));
    await expect(createProjectsRepository(client, TABLE).listPublished()).rejects.toBeInstanceOf(
      AppError,
    );
  });
});

describe("handler listProjects", () => {
  const sink = () => {
    const lines: string[] = [];
    return {
      lines,
      createLogger: (requestId: string) => createLogger(requestId, { sink: (l) => lines.push(l) }),
    };
  };
  const handlerOver = (items: readonly object[] = [PUBLISHED_PROJECT, DRAFT_PROJECT]) => {
    const { client, repository } = repoOver(items);
    const logs = sink();
    return {
      client,
      ...logs,
      handler: createListProjectsHandler({ repository, createLogger: logs.createLogger }),
    };
  };

  it("responde 200 con la lista de resúmenes públicos", async () => {
    const { handler } = handlerOver();
    const response = await handler(buildJwtEvent({ authorizer: false }));
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body as string);
    expect(body).toHaveLength(1);
    expect(body[0].projectId).toBe(PUBLISHED_PROJECT_ID);
  });

  it("es público: no necesita contexto de authorizer y no usa la cabecera Authorization", async () => {
    const { handler, client } = handlerOver();
    const anonymous = await handler(buildJwtEvent({ authorizer: false }));
    const withBadToken = await handler(
      buildJwtEvent({ authorizer: false, headers: { authorization: "Bearer token-falso" } }),
    );
    expect(anonymous.statusCode).toBe(200);
    expect(withBadToken.body).toBe(anonymous.body);
    expect(client.calls).toHaveLength(2);
  });

  it("la identidad o roles enviados por el cliente no cambian el resultado", async () => {
    const { handler } = handlerOver();
    const plain = await handler(buildJwtEvent({ authorizer: false }));
    const hostile = await handler(
      buildJwtEvent({
        authorizer: false,
        headers: { "x-user-groups": "GESTOR", "x-donor-sub": "impostor" },
      }),
    );
    expect(hostile.body).toBe(plain.body);
  });

  it("un catálogo vacío es 200 con [] (no un error)", async () => {
    const { handler } = handlerOver([DRAFT_PROJECT]);
    const response = await handler(buildJwtEvent({ authorizer: false }));
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("[]");
  });

  describe("parámetros de paginación inválidos", () => {
    it.each([
      ["limit negativo", { limit: "-1" }],
      ["limit cero", { limit: "0" }],
      ["limit no numérico", { limit: "abc" }],
      ["limit decimal", { limit: "1.5" }],
      ["limit enorme", { limit: "999999999999" }],
      ["limit en notación científica", { limit: "1e9" }],
      ["limit vacío", { limit: "" }],
      ["cursor arbitrario", { cursor: "eyJwcm9qZWN0SWQiOiJ4In0=" }],
      ["cursor con inyección", { cursor: '{"$ne":null}' }],
      ["page", { page: "2" }],
      ["offset", { offset: "10" }],
      ["nextToken", { nextToken: "abc" }],
      ["ExclusiveStartKey", { ExclusiveStartKey: '{"projectId":"x"}' }],
      ["status (intento de ver borradores)", { status: "BORRADOR" }],
      ["parámetro desconocido", { foo: "bar" }],
      ["varios a la vez", { limit: "-5", cursor: "x", page: "0" }],
    ])("%s → 400 INVALID_REQUEST sin consultar la base de datos", async (_label, query) => {
      const { handler, client } = handlerOver();
      const response = await handler(buildJwtEvent({ authorizer: false, query }));

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body as string)).toMatchObject({
        code: "INVALID_REQUEST",
        requestId: "test-request-id",
      });
      expect(client.calls).toHaveLength(0);
    });

    it("el 400 no revela el nombre ni el valor del parámetro rechazado", async () => {
      const { handler } = handlerOver();
      const response = await handler(
        buildJwtEvent({ authorizer: false, query: { limit: "-1337" } }),
      );
      expect(response.body).not.toMatch(/limit|1337/);
    });

    it("sin parámetros (undefined o vacío) funciona normalmente", async () => {
      const { handler } = handlerOver();
      const noQuery = buildJwtEvent({ authorizer: false });
      noQuery.queryStringParameters = undefined;
      expect((await handler(noQuery)).statusCode).toBe(200);
      expect((await handler(buildJwtEvent({ authorizer: false, query: {} }))).statusCode).toBe(200);
    });
  });

  describe("fallos de infraestructura (T10: error controlado)", () => {
    it("AccessDenied de DynamoDB → 500 uniforme sin filtrar el mensaje de AWS", async () => {
      const client = createRecordingClient(() =>
        Object.assign(
          new Error(
            "User: arn:aws:sts::123456789012:assumed-role/ListProjectsFn is not authorized to perform: dynamodb:PutItem on table prod-Projects",
          ),
          { name: "AccessDeniedException" },
        ),
      );
      const logs = sink();
      const handler = createListProjectsHandler({
        repository: createProjectsRepository(client, TABLE),
        createLogger: logs.createLogger,
      });
      const response = await handler(buildJwtEvent({ authorizer: false }));

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body as string).code).toBe("INTERNAL_ERROR");
      expect(response.body).not.toMatch(/arn:aws|assumed-role|dynamodb|PutItem|123456789012/i);
    });

    it("cualquier excepción inesperada es un 500 genérico", async () => {
      const handler = createListProjectsHandler({
        repository: { listPublished: vi.fn().mockRejectedValue(new Error("password=hunter2")) },
        createLogger: sink().createLogger,
      });
      const response = await handler(buildJwtEvent({ authorizer: false }));
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain("hunter2");
    });

    it("los datos corruptos del repositorio también terminan en 500 uniforme", async () => {
      const client = createRecordingClient(() => ({
        Items: [{ ...PUBLISHED_PROJECT, goalAmountCents: 1.5 }],
      }));
      const handler = createListProjectsHandler({
        repository: createProjectsRepository(client, TABLE),
        createLogger: sink().createLogger,
      });
      expect((await handler(buildJwtEvent({ authorizer: false }))).statusCode).toBe(500);
    });
  });

  describe("logs estructurados", () => {
    it("registra acción, resultado, estado y duración, sin datos de la solicitud", async () => {
      const { handler, lines } = handlerOver();
      await handler(
        buildJwtEvent({ authorizer: false, headers: { authorization: "Bearer SECRETO" } }),
      );
      const entry = JSON.parse(lines.at(-1)!);
      expect(entry).toMatchObject({
        level: "info",
        action: "listProjects",
        result: "success",
        statusCode: 200,
        requestId: "test-request-id",
      });
      expect(typeof entry.durationMs).toBe("number");
      expect(lines.join("\n")).not.toContain("SECRETO");
    });

    it("registra el error (sin detalle) cuando falla", async () => {
      const lines: string[] = [];
      const handler = createListProjectsHandler({
        repository: { listPublished: vi.fn().mockRejectedValue(new Error("boom interno")) },
        createLogger: (id) => createLogger(id, { sink: (line) => lines.push(line) }),
      });
      await handler(buildJwtEvent({ authorizer: false }));
      const entry = JSON.parse(lines.at(-1)!);
      expect(entry).toMatchObject({
        result: "error",
        statusCode: 500,
        errorCode: "INTERNAL_ERROR",
      });
      expect(lines.join("\n")).not.toContain("boom interno");
    });

    it("registra el rechazo por parámetros inválidos como denied/400", async () => {
      const { handler, lines } = handlerOver();
      await handler(buildJwtEvent({ authorizer: false, query: { limit: "-1" } }));
      expect(JSON.parse(lines.at(-1)!)).toMatchObject({ result: "denied", statusCode: 400 });
    });
  });
});
