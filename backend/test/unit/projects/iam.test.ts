/**
 * T10 — Privilegio mínimo: las funciones de lectura pública (listado, detalle, estadísticas) no
 * tienen permisos de escritura ni acceso a otras tablas. Se analiza infra/template.yaml (sin AWS):
 * el efecto de ejecutar una escritura con ese rol es AccessDenied, que el handler convierte en un
 * 500 controlado (cubierto en list.test.ts).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const TEMPLATE_PATH = fileURLToPath(new URL("../../../../infra/template.yaml", import.meta.url));

interface Statement {
  Effect: string;
  Action: string | string[];
  Resource: string | string[];
}
interface EventProps {
  Path: string;
  Method: string;
  ApiId?: unknown;
  Auth?: { Authorizer?: string; AuthorizationScopes?: string[] };
}
interface FunctionResource {
  Type: string;
  Condition?: string;
  Properties: {
    Policies?: ({ Statement?: Statement[] } | string)[];
    Events?: Record<string, { Type: string; Properties: EventProps }>;
    Role?: unknown;
  };
}

// logLevel silent: las etiquetas de CloudFormation (!Sub, !GetAtt…) se leen como datos simples.
const template = parse(readFileSync(TEMPLATE_PATH, "utf8"), { logLevel: "silent" }) as {
  Resources: Record<string, FunctionResource & { Type: string }>;
};
const functions = Object.entries(template.Resources).filter(
  ([, resource]) => resource.Type === "AWS::Serverless::Function",
) as [string, FunctionResource][];

const asList = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);
function statementsOf(name: string): Statement[] {
  const policies = template.Resources[name]!.Properties.Policies ?? [];
  return policies.flatMap((policy) => (typeof policy === "string" ? [] : (policy.Statement ?? [])));
}
const actionsOf = (name: string) => statementsOf(name).flatMap((s) => asList(s.Action));
const resourcesOf = (name: string) => statementsOf(name).flatMap((s) => asList(s.Resource));

const WRITE_ACTION = /(Put|Update|Delete|Batch|Transact|ConditionCheck|Create|Restore|Import|Tag)/;

const PUBLIC_READ: Record<string, { actions: string[]; resourceHint: RegExp }> = {
  ListProjectsFunction: {
    actions: ["dynamodb:Query"],
    resourceHint: /^\$\{ProjectsTable\.Arn\}\/index\/status-createdAt$/,
  },
  GetProjectFunction: { actions: ["dynamodb:GetItem"], resourceHint: /^ProjectsTable\.Arn$/ },
  GetProjectStatsFunction: { actions: ["dynamodb:GetItem"], resourceHint: /^ProjectsTable\.Arn$/ },
};

describe("T10: funciones públicas de lectura sin permisos de escritura", () => {
  it("existen las tres funciones públicas de lectura", () => {
    for (const name of Object.keys(PUBLIC_READ)) expect(template.Resources[name]).toBeDefined();
  });

  describe.each(Object.entries(PUBLIC_READ))("%s", (name, expected) => {
    it("solo tiene la acción de lectura esperada", () => {
      expect(actionsOf(name)).toEqual(expected.actions);
    });

    it("no tiene ninguna acción de escritura (Put/Update/Delete/Batch/Transact/ConditionCheck)", () => {
      expect(actionsOf(name).filter((action) => WRITE_ACTION.test(action))).toEqual([]);
    });

    it("no usa comodines en acciones ni recursos", () => {
      for (const value of [...actionsOf(name), ...resourcesOf(name)])
        expect(value).not.toContain("*");
    });

    it("solo accede a la tabla Projects (ni Donations, ni Idempotency, ni AuditEvents)", () => {
      const resources = resourcesOf(name);
      expect(resources.length).toBeGreaterThan(0);
      for (const resource of resources) expect(resource).toMatch(expected.resourceHint);
      expect(resources.join(" ")).not.toMatch(/Donations|Idempotency|AuditEvents/);
    });

    it("las sentencias son solo Allow y no hay políticas administradas ni plantillas amplias", () => {
      const policies = template.Resources[name]!.Properties.Policies ?? [];
      expect(policies.length).toBeGreaterThan(0);
      for (const policy of policies) expect(typeof policy).toBe("object");
      for (const statement of statementsOf(name)) expect(statement.Effect).toBe("Allow");
    });

    it("no sobrescribe el rol con uno externo (el rol lo genera SAM a partir de Policies)", () => {
      expect(template.Resources[name]!.Properties.Role).toBeUndefined();
    });
  });

  it("el listado consulta el índice, no la tabla completa (sin Scan)", () => {
    expect(actionsOf("ListProjectsFunction")).not.toContain("dynamodb:Scan");
    expect(resourcesOf("ListProjectsFunction")[0]).toContain("/index/status-createdAt");
  });

  it("solo las funciones que deben escribir tienen acciones de escritura", () => {
    const writers = functions
      .map(([name]) => name)
      .filter((name) => actionsOf(name).some((action) => WRITE_ACTION.test(action)))
      .sort();
    expect(writers).toEqual(
      [
        "CreateDonationFunction",
        "CreateProjectFunction",
        "PublishProjectFunction",
        "SimulateDonationFunction",
      ].sort(),
    );
  });
});

describe("T042: rutas públicas del catálogo", () => {
  const routesOf = (name: string) =>
    Object.values(template.Resources[name]!.Properties.Events ?? {}).map(
      (event) => event.Properties,
    );

  it("el listado expone solo GET /v1/projects, sin autenticación", () => {
    const routes = routesOf("ListProjectsFunction");
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ Path: "/v1/projects", Method: "GET" });
    expect(routes[0]!.Auth).toBeUndefined();
  });

  it("el detalle expone solo GET /v1/projects/{projectId}, sin autenticación (T093)", () => {
    const routes = routesOf("GetProjectFunction");
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ Path: "/v1/projects/{projectId}", Method: "GET" });
    expect(routes[0]!.Auth).toBeUndefined();
  });

  it("las estadísticas exponen solo GET /v1/projects/{projectId}/stats, sin autenticación", () => {
    const routes = routesOf("GetProjectStatsFunction");
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ Path: "/v1/projects/{projectId}/stats", Method: "GET" });
    expect(routes[0]!.Auth).toBeUndefined();
  });

  it("toda ruta sin autenticación es un GET de la lista blanca pública", () => {
    const allowed = new Set([
      "GET /v1/projects",
      "GET /v1/projects/{projectId}",
      "GET /v1/projects/{projectId}/stats",
    ]);
    const publicRoutes = functions.flatMap(([name]) =>
      routesOf(name)
        .filter((route) => route.Auth === undefined)
        .map((route) => `${route.Method} ${route.Path}`),
    );
    expect(publicRoutes.length).toBeGreaterThanOrEqual(3);
    for (const route of publicRoutes) expect(allowed.has(route)).toBe(true);
  });

  it("toda ruta protegida usa el authorizer JWT y declara scopes (así se rechazan los ID tokens)", () => {
    for (const [name] of functions) {
      for (const route of routesOf(name).filter((r) => r.Auth !== undefined)) {
        expect(route.Auth!.Authorizer).toBe("CognitoJwt");
        expect(route.Auth!.AuthorizationScopes?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("las rutas públicas se enlazan a la API explícita del template", () => {
    for (const name of ["ListProjectsFunction", "GetProjectFunction", "GetProjectStatsFunction"]) {
      for (const route of routesOf(name)) expect(route.ApiId).toBeDefined();
    }
  });
});

describe("Fases 7-8 (extensión): privilegio mínimo y rutas de las funciones de escritura", () => {
  const sorted = (values: string[]) => [...values].sort();

  it("CreateProjectFunction: solo PutItem sobre Projects y AuditEvents", () => {
    expect(sorted(actionsOf("CreateProjectFunction"))).toEqual(
      ["dynamodb:PutItem", "dynamodb:PutItem"].slice(0, 1),
    );
    expect(resourcesOf("CreateProjectFunction").join(" ")).not.toMatch(/Donations|Idempotency/);
  });

  it("PublishProjectFunction: GetItem y UpdateItem sobre Projects, PutItem sobre AuditEvents; sin Delete ni Scan", () => {
    expect(sorted(actionsOf("PublishProjectFunction"))).toEqual([
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
    ]);
    expect(actionsOf("PublishProjectFunction").join(" ")).not.toMatch(/Delete|Scan|Query|Batch/);
    expect(resourcesOf("PublishProjectFunction").join(" ")).not.toMatch(/Donations|Idempotency/);
  });

  it("CreateDonationFunction: no puede modificar ni borrar proyectos ni leer el historial de otros", () => {
    const statements = statementsOf("CreateDonationFunction");
    const projectsActions = statements
      .filter((s) => asList(s.Resource).join(" ").includes("ProjectsTable"))
      .flatMap((s) => asList(s.Action));
    expect(sorted(projectsActions)).toEqual(["dynamodb:ConditionCheckItem", "dynamodb:GetItem"]);
    const all = actionsOf("CreateDonationFunction").join(" ");
    expect(all).not.toMatch(/UpdateItem|Delete|Scan|Query|Batch/);
  });

  it("CreateDonationFunction escribe donaciones, idempotencia y auditoría, y nada más", () => {
    const tables = new Set(
      statementsOf("CreateDonationFunction").flatMap((s) =>
        asList(s.Resource).map((r) => String(r).replace(/\$\{|\}|\.Arn/g, "")),
      ),
    );
    expect([...tables].sort()).toEqual([
      "AuditEventsTable",
      "DonationsTable",
      "IdempotencyTable",
      "ProjectsTable",
    ]);
  });

  it.each([
    ["POST", "/v1/projects", "api/projects.write"],
    ["PATCH", "/v1/projects/{projectId}/publish", "api/projects.write"],
    ["POST", "/v1/donations", "api/donations.write"],
    ["GET", "/v1/donations/me", "api/donations.read"],
    ["GET", "/v1/donations/{donationId}", "api/donations.read"],
  ])("la ruta %s %s está protegida con el authorizer JWT y el scope %s", (method, path, scope) => {
    const route = functions
      .flatMap(([name]) => Object.values(template.Resources[name]!.Properties.Events ?? {}))
      .map((event) => event.Properties)
      .find((props) => props.Method === method && props.Path === path);
    expect(route, `falta la ruta ${method} ${path}`).toBeDefined();
    expect(route!.Auth).toEqual({ Authorizer: "CognitoJwt", AuthorizationScopes: [scope] });
  });
});

describe("Fase 9 (extensión): privilegio mínimo de la simulación (T086)", () => {
  const sorted = (values: string[]) => [...values].sort();
  const actionsOn = (name: string, table: string) =>
    statementsOf(name)
      .filter((s) => asList(s.Resource).join(" ").includes(table))
      .flatMap((s) => asList(s.Action));

  it("Donations: solo GetItem (lectura previa) y UpdateItem (transición)", () => {
    expect(sorted(actionsOn("SimulateDonationFunction", "DonationsTable"))).toEqual([
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
    ]);
  });

  it("Projects: solo UpdateItem (ADD del acumulado): no lee ni crea ni borra proyectos", () => {
    expect(actionsOn("SimulateDonationFunction", "ProjectsTable")).toEqual(["dynamodb:UpdateItem"]);
  });

  it("AuditEvents: solo PutItem; no toca Idempotency", () => {
    expect(actionsOn("SimulateDonationFunction", "AuditEventsTable")).toEqual(["dynamodb:PutItem"]);
    expect(resourcesOf("SimulateDonationFunction").join(" ")).not.toMatch(/IdempotencyTable/);
  });

  it("sin Delete, Scan, Query, Batch, ConditionCheck ni comodines", () => {
    expect(actionsOf("SimulateDonationFunction").join(" ")).not.toMatch(
      /Delete|Scan|Query|Batch|ConditionCheck|\*/,
    );
    expect(resourcesOf("SimulateDonationFunction").join(" ")).not.toContain("*");
  });

  it("no puede crear donaciones ni proyectos (sin PutItem sobre Donations ni Projects)", () => {
    expect(actionsOn("SimulateDonationFunction", "DonationsTable")).not.toContain(
      "dynamodb:PutItem",
    );
    expect(actionsOn("SimulateDonationFunction", "ProjectsTable")).not.toContain(
      "dynamodb:PutItem",
    );
  });
});

describe("Fase 11 (extensión): privilegio mínimo de consulta de historial (T100)", () => {
  it("ListMyDonationsFunction: solo Query sobre el GSI donorSub-createdAt", () => {
    expect(actionsOf("ListMyDonationsFunction")).toEqual(["dynamodb:Query"]);
    expect(resourcesOf("ListMyDonationsFunction")[0]).toContain("/index/donorSub-createdAt");
  });

  it("GetDonationFunction: solo GetItem sobre DonationsTable", () => {
    expect(actionsOf("GetDonationFunction")).toEqual(["dynamodb:GetItem"]);
    expect(resourcesOf("GetDonationFunction")[0]).toContain("DonationsTable");
  });
});
