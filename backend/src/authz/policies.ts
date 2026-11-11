/**
 * RBAC y ownership en el servidor (T022). Denegación por defecto: una acción desconocida o un
 * principal sin el rol y el scope exigidos recibe 403 uniforme. Un acceso a un recurso ajeno o
 * inexistente recibe el MISMO 404, de modo que no se revela su existencia (prueba BOLA, CA-07.2).
 *
 * Los guards de la UI solo aportan UX; esta es la decisión autoritativa.
 */
import type { Role } from "@donaciones/shared";
import { forbidden, notFound } from "../shared/http";
import type { Principal } from "./principal";

export interface ActionPolicy {
  readonly roles: readonly Role[];
  readonly scope: string;
}

const ACTION_TABLE = {
  "project:create": { roles: ["GESTOR"], scope: "api/projects.write" },
  "project:publish": { roles: ["GESTOR"], scope: "api/projects.write" },
  "donation:create": { roles: ["DONANTE"], scope: "api/donations.write" },
  "donation:simulate": { roles: ["DONANTE"], scope: "api/donations.write" },
  "donation:list-own": { roles: ["DONANTE"], scope: "api/donations.read" },
  "donation:read-own": { roles: ["DONANTE"], scope: "api/donations.read" },
  "audit:read": { roles: ["AUDITOR"], scope: "api/audit.read" },
} as const satisfies Record<string, ActionPolicy>;

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** Inmutable en tiempo de ejecución: nada puede añadir roles ni scopes a una acción. */
export const ACTIONS = deepFreeze(ACTION_TABLE);

export type Action = keyof typeof ACTION_TABLE;

function policyFor(action: string): ActionPolicy | undefined {
  return Object.hasOwn(ACTIONS, action) ? ACTIONS[action as Action] : undefined;
}

/** `true` si el principal tiene alguno de los roles y el scope de la acción. */
export function can(principal: Principal, action: Action): boolean {
  const policy = policyFor(action);
  if (!policy) return false;
  return (
    principal.roles.some((role) => policy.roles.includes(role)) &&
    principal.scopes.includes(policy.scope)
  );
}

/** Lanza 403 si el principal no puede ejecutar la acción. */
export function authorize(principal: Principal, action: Action): void {
  if (!can(principal, action)) throw forbidden(`acción denegada: ${String(action)}`);
}

/** Exige que el recurso persistido pertenezca al principal; ajeno o inexistente → 404 uniforme. */
export function assertOwner(
  principal: Principal,
  resource: { donorSub?: unknown } | null | undefined,
): void {
  const owner = resource?.donorSub;
  if (typeof owner !== "string" || owner.length === 0 || owner !== principal.sub) {
    throw notFound("recurso inexistente o ajeno");
  }
}

/** Combina RBAC y ownership sobre el recurso ya leído de la base de datos. */
export function authorizeOwned(
  principal: Principal,
  action: Action,
  resource: { donorSub?: unknown } | null | undefined,
): void {
  authorize(principal, action);
  assertOwner(principal, resource);
}
