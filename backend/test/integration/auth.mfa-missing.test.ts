/**
 * T056 — GESTOR y AUDITOR sin segundo factor no obtienen tokens (CA-11.1, CA-11.2) y no se ofrece MFA
 * por SMS.
 *
 * ALCANCE HONESTO: "no obtienen tokens sin completar el segundo factor" es un comportamiento de
 * Cognito (Hosted UI + User Pool) que SOLO puede comprobarse contra un User Pool desplegado. Aquí se
 * verifica de forma estática que la configuración lo exige (MFA obligatorio, solo TOTP, sin SMS) y se
 * deja el comportamiento real como pruebas PENDIENTES (`it.todo`), sin simularlas. Procedimiento
 * manual en evidence/mfa.md y evidence/auth-pending-deployment.md.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPrincipal } from "../../src/authz/principal";
import { buildJwtEvent, FIXED_NOW_MS } from "../helpers/setup";
import { asList, resource, resourcesOfType, template } from "../helpers/template";

const userPool = () => resource("UserPool").Properties;

describe("T058/T056: configuración estática de MFA en el User Pool", () => {
  it("MFA obligatorio (ON) para todo el pool, por lo que alcanza a GESTOR y AUDITOR", () => {
    expect(userPool().MfaConfiguration).toBe("ON");
  });

  it("MFA no es opcional: con OPTIONAL un GESTOR sin segundo factor obtendría tokens (CA-11.2)", () => {
    expect(userPool().MfaConfiguration).not.toBe("OPTIONAL");
    expect(userPool().MfaConfiguration).not.toBe("OFF");
  });

  it("el único segundo factor habilitado es la aplicación autenticadora (TOTP)", () => {
    expect(userPool().EnabledMfas).toEqual(["SOFTWARE_TOKEN_MFA"]);
  });

  describe("no se ofrece MFA por SMS (CA-11.1)", () => {
    it("SMS_MFA no está habilitado", () => {
      expect(asList<string>(userPool().EnabledMfas)).not.toContain("SMS_MFA");
    });

    it.each(["SmsConfiguration", "SmsAuthenticationMessage", "SmsVerificationMessage"])(
      "el User Pool no define %s",
      (property) => {
        expect(userPool()[property]).toBeUndefined();
      },
    );

    it("no se verifica ni recupera la cuenta por teléfono (solo correo)", () => {
      expect(userPool().AutoVerifiedAttributes).toEqual(["email"]);
      expect(userPool().UsernameAttributes).toEqual(["email"]);
      expect(
        asList<{ Name: string }>(userPool().AccountRecoverySetting.RecoveryMechanisms).map(
          (m) => m.Name,
        ),
      ).toEqual(["verified_email"]);
    });

    it("ningún recurso de Cognito de la plantilla menciona SMS ni teléfono", () => {
      const cognito = resourcesOfType("AWS::Cognito::UserPool")
        .concat(resourcesOfType("AWS::Cognito::UserPoolClient"))
        .concat(resourcesOfType("AWS::Cognito::UserPoolGroup"));
      const text = JSON.stringify(cognito);
      expect(text).not.toMatch(/SMS_|Sms[A-Z]|\bsms\b|sms_|phone|telef/i);
    });

    it("el frontend no contiene ninguna interfaz ni referencia a MFA por SMS", () => {
      const root = fileURLToPath(new URL("../../../frontend/src", import.meta.url));
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          if (statSync(full).isDirectory()) walk(full);
          else if (/\.(tsx?|css|html)$/.test(entry)) files.push(full);
        }
      };
      walk(root);
      expect(files.length).toBeGreaterThan(5);
      for (const file of files) {
        expect(readFileSync(file, "utf8"), file).not.toMatch(/SMS_MFA|\bsms\b/i);
      }
    });
  });

  it("no hay disparadores Lambda de Cognito que puedan saltarse o relajar el desafío MFA", () => {
    expect(userPool().LambdaConfig).toBeUndefined();
  });

  it("el cierre de la brecha del alta: solo el administrador crea usuarios (nadie se registra solo sin MFA)", () => {
    expect(userPool().AdminCreateUserConfig.AllowAdminCreateUserOnly).toBe(true);
  });

  it("existen los grupos GESTOR y AUDITOR, ambos dentro del pool con MFA obligatorio", () => {
    const groups = resourcesOfType("AWS::Cognito::UserPoolGroup").map(
      ([, g]) => g.Properties.GroupName,
    );
    expect(groups).toEqual(expect.arrayContaining(["GESTOR", "AUDITOR", "DONANTE"]));
    for (const [, group] of resourcesOfType("AWS::Cognito::UserPoolGroup")) {
      expect(group.Properties.UserPoolId).toBe("UserPool");
    }
  });

  it("política de contraseñas mínima de 12 caracteres (segunda línea de defensa)", () => {
    expect(userPool().Policies.PasswordPolicy.MinimumLength).toBeGreaterThanOrEqual(12);
  });

  it("la decisión (MFA para todos por limitación de Cognito) está explicada en la plantilla", () => {
    const text = readFileSync(
      fileURLToPath(new URL("../../../infra/template.yaml", import.meta.url)),
      "utf8",
    );
    expect(text).toMatch(/a nivel de User Pool, no por grupo/);
    expect(template.Resources.UserPool).toBeDefined();
  });
});

describe("el backend no puede verificar el segundo factor (límite conocido)", () => {
  it("un claim 'amr' que afirma MFA no concede nada: el backend no lo exige ni lo confía", () => {
    const base = buildJwtEvent({ groups: ["GESTOR"], scopes: ["api/projects.write"] });
    const withAmr = buildJwtEvent({
      groups: ["GESTOR"],
      scopes: ["api/projects.write"],
      claims: { amr: ["mfa", "swk"] },
    });
    const without = buildJwtEvent({
      groups: ["GESTOR"],
      scopes: ["api/projects.write"],
      claims: { amr: undefined },
    });
    const principal = (event: typeof base) => buildPrincipal(event, { now: () => FIXED_NOW_MS });
    expect(principal(withAmr)).toEqual(principal(base));
    expect(principal(without)).toEqual(principal(base));
  });
});

describe("PENDIENTE DE DESPLIEGUE (requiere un User Pool de Cognito real)", () => {
  it.todo("un GESTOR que inicia sesión sin completar el segundo factor NO recibe tokens (CA-11.2)");
  it.todo(
    "un AUDITOR que inicia sesión sin completar el segundo factor NO recibe tokens (CA-11.2)",
  );
  it.todo(
    "el Hosted UI solicita configurar TOTP en el primer inicio de sesión de un GESTOR/AUDITOR nuevo",
  );
  it.todo("un código TOTP incorrecto o vencido no emite tokens");
  it.todo("el Hosted UI no ofrece SMS como método de segundo factor (CA-11.1)");
  it.todo("un DONANTE también debe completar TOTP (decisión: MFA obligatorio en todo el pool)");
});
