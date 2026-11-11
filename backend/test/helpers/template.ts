/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Lee infra/template.yaml como datos (sin AWS): las etiquetas de CloudFormation (!Ref, !Sub…) se
 * degradan a texto, de modo que `!Ref UserPool` es la cadena "UserPool". Sirve para comprobar la
 * configuración de identidad (Cognito + authorizer) de forma estática.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const TEMPLATE_PATH = fileURLToPath(new URL("../../../infra/template.yaml", import.meta.url));

export interface TemplateResource {
  Type: string;
  Condition?: string;
  Properties: Record<string, any>;
}

export const templateText = readFileSync(TEMPLATE_PATH, "utf8");

export const template = parse(templateText, { logLevel: "silent" }) as {
  Parameters: Record<string, any>;
  Globals: Record<string, any>;
  Resources: Record<string, TemplateResource>;
  Outputs: Record<string, any>;
};

export const resource = (name: string): TemplateResource => {
  const found = template.Resources[name];
  if (!found) throw new Error(`Recurso inexistente en la plantilla: ${name}`);
  return found;
};

export const resourcesOfType = (type: string): [string, TemplateResource][] =>
  Object.entries(template.Resources).filter(([, r]) => r.Type === type);

export const asList = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** Rutas con `Events` de tipo HttpApi de todas las funciones. */
export function allRoutes() {
  return resourcesOfType("AWS::Serverless::Function").flatMap(([functionName, fn]) =>
    Object.values((fn.Properties.Events ?? {}) as Record<string, any>)
      .filter((event) => event.Type === "HttpApi")
      .map((event) => ({
        functionName,
        path: event.Properties.Path as string,
        method: event.Properties.Method as string,
        auth: event.Properties.Auth as
          { Authorizer?: string; AuthorizationScopes?: string[] } | undefined,
      })),
  );
}
