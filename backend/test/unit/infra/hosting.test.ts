/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T115 — Hosting de la SPA: bucket S3 privado, CloudFront con OAC, cabeceras de seguridad (HSTS,
 * X-Content-Type-Options, Referrer-Policy, X-Frame-Options, CSP) y CORS/Cognito alineados con el
 * dominio de CloudFront. Análisis estático de infra/template.yaml (sin AWS); la plantilla además se
 * valida con `cfn-lint` y con la transformación SAM (`python scripts/validate-template.py`).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { asList, resource, template } from "../../helpers/template";

const bucket = () => resource("SpaBucket").Properties;
const distribution = () => resource("SpaDistribution").Properties.DistributionConfig;
const headers = () =>
  resource("SpaResponseHeadersPolicy").Properties.ResponseHeadersPolicyConfig as Record<
    string,
    any
  >;
const policyStatements = (name: string): Record<string, any>[] =>
  asList(resource(name).Properties.PolicyDocument.Statement);

describe("bucket S3 de la SPA: privado", () => {
  it("bloquea todo el acceso público (ACL y políticas)", () => {
    expect(bucket().PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
  });

  it("deshabilita las ACL (BucketOwnerEnforced) y cifra en reposo", () => {
    expect(bucket().OwnershipControls.Rules).toEqual([{ ObjectOwnership: "BucketOwnerEnforced" }]);
    expect(
      bucket().BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault
        .SSEAlgorithm,
    ).toBe("AES256");
  });

  it("no es un sitio web de S3 ni tiene ACL pública, CORS propio ni nombre fijo", () => {
    for (const property of [
      "WebsiteConfiguration",
      "AccessControl",
      "CorsConfiguration",
      "BucketName",
    ]) {
      expect(bucket()[property], property).toBeUndefined();
    }
  });
});

describe("política del bucket: solo CloudFront puede leer", () => {
  const statements = () => policyStatements("SpaBucketPolicy");
  const allows = () => statements().filter((s) => s.Effect === "Allow");

  it("el único Allow es s3:GetObject para el servicio cloudfront.amazonaws.com sobre los objetos", () => {
    expect(allows()).toHaveLength(1);
    const [allow] = allows();
    expect(allow!.Principal).toEqual({ Service: "cloudfront.amazonaws.com" });
    expect(allow!.Action).toBe("s3:GetObject");
    expect(allow!.Resource).toBe("${SpaBucket.Arn}/*");
  });

  it("restringe el Allow a ESTA distribución (AWS:SourceArn)", () => {
    const condition = allows()[0]!.Condition.StringEquals["AWS:SourceArn"] as string;
    expect(condition).toContain("distribution/${SpaDistribution}");
    expect(condition).toContain("${AWS::AccountId}");
  });

  it("nunca concede acceso a un principal comodín ni permite escribir o listar", () => {
    for (const statement of allows()) {
      expect(JSON.stringify(statement.Principal)).not.toMatch(/"\*"/);
      expect(JSON.stringify(statement.Action)).not.toMatch(/Put|Delete|List|\*/);
    }
  });

  it("deniega todo acceso sin TLS", () => {
    const deny = statements().find((s) => s.Effect === "Deny")!;
    expect(deny.Principal).toBe("*");
    expect(deny.Condition).toEqual({ Bool: { "aws:SecureTransport": "false" } });
    expect(JSON.stringify(deny.Resource)).toContain("SpaBucket.Arn");
  });
});

describe("CloudFront con Origin Access Control", () => {
  it("el OAC firma con SigV4 siempre y es de tipo s3", () => {
    expect(resource("SpaOriginAccessControl").Properties.OriginAccessControlConfig).toMatchObject({
      OriginAccessControlOriginType: "s3",
      SigningBehavior: "always",
      SigningProtocol: "sigv4",
    });
  });

  it("el origen usa el OAC, el dominio REGIONAL del bucket (no el endpoint web) y ningún OAI heredado", () => {
    const [origin] = distribution().Origins;
    expect(origin.OriginAccessControlId).toBe("SpaOriginAccessControl.Id");
    expect(origin.DomainName).toBe("SpaBucket.RegionalDomainName");
    expect(origin.S3OriginConfig.OriginAccessIdentity).toBe("");
    expect(origin.CustomOriginConfig).toBeUndefined();
  });

  it("redirige a HTTPS y solo permite GET y HEAD", () => {
    const behavior = distribution().DefaultCacheBehavior;
    expect(behavior.ViewerProtocolPolicy).toBe("redirect-to-https");
    expect(behavior.AllowedMethods).toEqual(["GET", "HEAD"]);
    expect(behavior.Compress).toBe(true);
  });

  it("aplica la política de cabeceras de seguridad al comportamiento por defecto", () => {
    expect(distribution().DefaultCacheBehavior.ResponseHeadersPolicyId).toBe(
      "SpaResponseHeadersPolicy",
    );
  });

  it("sirve index.html y enruta 403/404 de S3 hacia la SPA con 200", () => {
    expect(distribution().DefaultRootObject).toBe("index.html");
    const errors = distribution().CustomErrorResponses;
    expect(errors.map((e: any) => e.ErrorCode).sort()).toEqual([403, 404]);
    for (const error of errors) {
      expect(error).toMatchObject({ ResponsePagePath: "/index.html", ResponseCode: 200 });
    }
  });

  it("está habilitada y usa el certificado por defecto de CloudFront (TLS 1.2 exige dominio propio: pendiente)", () => {
    expect(distribution().Enabled).toBe(true);
    expect(distribution().ViewerCertificate.CloudFrontDefaultCertificate).toBe(true);
  });
});

describe("cabeceras de seguridad de respuesta", () => {
  const security = () => headers().SecurityHeadersConfig;

  it("HSTS: al menos un año, subdominios y sobrescribe", () => {
    expect(security().StrictTransportSecurity).toMatchObject({
      IncludeSubdomains: true,
      Override: true,
    });
    expect(security().StrictTransportSecurity.AccessControlMaxAgeSec).toBeGreaterThanOrEqual(
      31_536_000,
    );
  });

  it("X-Content-Type-Options: nosniff (sobrescribe)", () => {
    expect(security().ContentTypeOptions).toEqual({ Override: true });
  });

  it("Referrer-Policy restrictiva (sobrescribe)", () => {
    expect([
      "no-referrer",
      "same-origin",
      "strict-origin",
      "strict-origin-when-cross-origin",
    ]).toContain(security().ReferrerPolicy.ReferrerPolicy);
    expect(security().ReferrerPolicy.Override).toBe(true);
  });

  it("X-Frame-Options: DENY", () => {
    expect(security().FrameOptions).toEqual({ FrameOption: "DENY", Override: true });
  });

  it("Permissions-Policy cierra cámara, micrófono, geolocalización y pagos; COOP same-origin", () => {
    const items = headers().CustomHeadersConfig.Items as {
      Header: string;
      Value: string;
      Override: boolean;
    }[];
    const byName = Object.fromEntries(items.map((i) => [i.Header, i]));
    expect(byName["Permissions-Policy"]!.Value).toBe(
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    expect(byName["Cross-Origin-Opener-Policy"]!.Value).toBe("same-origin");
    expect(items.every((i) => i.Override)).toBe(true);
  });
});

describe("Content-Security-Policy", () => {
  const raw = () => security().ContentSecurityPolicy.ContentSecurityPolicy as string;
  const security = () => headers().SecurityHeadersConfig;
  const directives = () =>
    Object.fromEntries(
      raw()
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const [name, ...sources] = part.split(/\s+/);
          return [name!, sources];
        }),
    ) as Record<string, string[]>;

  it("sobrescribe y no está vacía", () => {
    expect(security().ContentSecurityPolicy.Override).toBe(true);
    expect(raw().length).toBeGreaterThan(50);
  });

  it("por defecto todo es 'self'; scripts y estilos solo desde el propio origen", () => {
    expect(directives()["default-src"]).toEqual(["'self'"]);
    expect(directives()["script-src"]).toEqual(["'self'"]);
    expect(directives()["style-src"]).toEqual(["'self'"]);
  });

  it("sin 'unsafe-inline', 'unsafe-eval', comodines globales ni orígenes http:", () => {
    expect(raw()).not.toMatch(/unsafe-inline|unsafe-eval|unsafe-hashes/);
    for (const sources of Object.values(directives())) {
      expect(sources).not.toContain("*");
      expect(sources).not.toContain("http:");
      expect(sources.some((s) => s.startsWith("http://"))).toBe(false);
    }
  });

  it("cierra objetos, marcos, base y formularios", () => {
    expect(directives()["object-src"]).toEqual(["'none'"]);
    expect(directives()["frame-ancestors"]).toEqual(["'none'"]);
    expect(directives()["base-uri"]).toEqual(["'self'"]);
    expect(directives()["form-action"]).toEqual(["'self'"]);
    expect(directives()["upgrade-insecure-requests"]).toEqual([]);
  });

  it("img-src admite data: (recursos pequeños de Vite) y nada más que 'self'", () => {
    expect(directives()["img-src"]).toEqual(["'self'", "data:"]);
  });

  it("connect-src permite solo el propio origen, la API, el IdP de Cognito y su Hosted UI", () => {
    const sources = directives()["connect-src"]!;
    expect(sources).toEqual([
      "'self'",
      "https://*.execute-api.${AWS::Region}.amazonaws.com",
      "https://cognito-idp.${AWS::Region}.amazonaws.com",
      "https://${UserPoolDomain}.auth.${AWS::Region}.amazoncognito.com",
    ]);
  });

  it("el comodín *.execute-api es el único y se justifica en la plantilla (evita una dependencia circular)", () => {
    const wildcards = raw().match(/\*/g) ?? [];
    expect(wildcards).toHaveLength(1);
    expect(raw()).toContain("https://*.execute-api.");
    const text = readFileSync(
      fileURLToPath(new URL("../../../../infra/template.yaml", import.meta.url)),
      "utf8",
    );
    expect(text).toMatch(/dependencia circular/);
  });

  describe("la SPA es compatible con esta política", () => {
    const frontend = fileURLToPath(new URL("../../../../frontend", import.meta.url));
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(tsx?|css)$/.test(entry)) sources.push(full);
      }
    };
    walk(join(frontend, "src"));

    it("index.html no tiene scripts ni estilos en línea ni manejadores on*", () => {
      const html = readFileSync(join(frontend, "index.html"), "utf8");
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
      expect(html).not.toMatch(/<style/i);
      expect(html).not.toMatch(/\sstyle=/i);
      expect(html).not.toMatch(/\son[a-z]+=/i);
    });

    it("el código no usa eval, new Function ni dangerouslySetInnerHTML", () => {
      expect(sources.length).toBeGreaterThan(5);
      for (const file of sources) {
        const content = readFileSync(file, "utf8");
        expect(content, file).not.toMatch(
          /\beval\(|new Function\(|dangerouslySetInnerHTML|document\.write\(/,
        );
      }
    });
  });
});

describe("CORS y Cognito alineados con el dominio de CloudFront", () => {
  const spa = "SpaDistribution.DomainName";

  it("la lista de orígenes de las Lambdas incluye el dominio de CloudFront y conserva los del parámetro", () => {
    const origins = JSON.stringify(template.Globals.Function.Environment.Variables.ALLOWED_ORIGINS);
    expect(origins).toContain(spa);
    expect(origins).toContain("AllowedOrigins");
  });

  it("CORS de la API incluye el dominio de CloudFront y ningún comodín", () => {
    const origins = JSON.stringify(resource("HttpApi").Properties.CorsConfiguration.AllowOrigins);
    expect(origins).toContain(spa);
    expect(origins).not.toContain('"*"');
    expect(resource("HttpApi").Properties.CorsConfiguration.AllowHeaders).toEqual([
      "authorization",
      "content-type",
      "idempotency-key",
    ]);
  });

  it("el cliente de Cognito acepta como retorno y cierre de sesión el dominio de CloudFront (y los del parámetro)", () => {
    const client = resource("UserPoolClient").Properties;
    const callbacks = JSON.stringify(client.CallbackURLs);
    const logouts = JSON.stringify(client.LogoutURLs);
    expect(callbacks).toContain(`${spa}}/callback`.replace("}}", "}"));
    expect(callbacks).toContain("CallbackUrls");
    expect(logouts).toContain(spa);
    expect(logouts).toContain("LogoutUrls");
    expect(callbacks + logouts).not.toContain("*");
  });

  it("la plantilla expone el bucket, la distribución y la URL de la SPA", () => {
    for (const output of ["SpaBucketName", "SpaDistributionId", "SpaUrl"]) {
      expect(template.Outputs[output], output).toBeDefined();
    }
    expect(template.Outputs.SpaUrl.Value).toBe("https://${SpaDistribution.DomainName}");
  });
});
