/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T116 — Throttling del stage, retención de 14 días de TODOS los grupos de logs, registro de acceso sin
 * datos personales y CloudTrail. Análisis estático de infra/template.yaml (sin AWS); además se valida
 * con `cfn-lint` y con la transformación SAM (`python scripts/validate-template.py`).
 */
import { describe, expect, it } from "vitest";
import { asList, resource, resourcesOfType, template } from "../../helpers/template";

const functions = () => resourcesOfType("AWS::Serverless::Function");
const logGroups = () => resourcesOfType("AWS::Logs::LogGroup");

describe("throttling del stage de la API", () => {
  const settings = () => resource("HttpApi").Properties.DefaultRouteSettings;

  it("define límites de ritmo y de ráfaga positivos y moderados para todas las rutas", () => {
    expect(settings().ThrottlingRateLimit).toBeGreaterThan(0);
    expect(settings().ThrottlingBurstLimit).toBeGreaterThan(0);
    expect(settings().ThrottlingRateLimit).toBeLessThanOrEqual(100);
    expect(settings().ThrottlingBurstLimit).toBeLessThanOrEqual(200);
    expect(settings().ThrottlingBurstLimit).toBeGreaterThanOrEqual(settings().ThrottlingRateLimit);
  });
});

describe("registro de acceso de la API", () => {
  const access = () => resource("HttpApi").Properties.AccessLogSettings;

  it("escribe en el grupo de logs de la API", () => {
    expect(access().DestinationArn).toBe("ApiAccessLogGroup.Arn");
    expect(resource("ApiAccessLogGroup").Type).toBe("AWS::Logs::LogGroup");
  });

  it("es JSON y solo registra datos operativos: sin IP, agente, cabeceras, claims ni cuerpos", () => {
    const format = JSON.parse(access().Format as string) as Record<string, string>;
    expect(Object.keys(format).sort()).toEqual(
      ["integrationStatus", "requestId", "responseLatency", "routeKey", "status"].sort(),
    );
    const raw = access().Format as string;
    expect(raw).not.toMatch(
      /sourceIp|userAgent|requestHeaders|authorizer|claims|identity|requestBody|queryString|path\b/i,
    );
  });
});

describe("retención de 14 días en TODOS los grupos de logs", () => {
  it("hay grupos de logs y cada uno retiene exactamente 14 días", () => {
    expect(logGroups().length).toBeGreaterThanOrEqual(10);
    for (const [name, group] of logGroups()) {
      expect(group.Properties.RetentionInDays, name).toBe(14);
    }
  });

  it("cada función Lambda escribe en su PROPIO grupo declarado en la plantilla", () => {
    const used = new Set<string>();
    for (const [name, fn] of functions()) {
      const target = fn.Properties.LoggingConfig?.LogGroup as string | undefined;
      expect(target, `${name} sin LoggingConfig.LogGroup`).toBeDefined();
      expect(resource(target!).Type, name).toBe("AWS::Logs::LogGroup");
      expect(used.has(target!), `${name} comparte grupo`).toBe(false);
      used.add(target!);
    }
    expect(used.size).toBe(functions().length);
  });

  it("los nombres de los grupos siguen /aws/lambda/secure-donations-<Stage>-<handler>", () => {
    for (const [name, fn] of functions()) {
      const group = resource(fn.Properties.LoggingConfig.LogGroup as string);
      const handler = (fn.Properties.Handler as string).replace(".handler", "");
      expect(group.Properties.LogGroupName, name).toBe(
        `/aws/lambda/secure-donations-\${Stage}-${handler}`,
      );
    }
  });

  it("el grupo de la función de simulación tiene la misma condición que la función (solo en academic)", () => {
    const fn = resource("SimulateDonationFunction");
    const group = resource(fn.Properties.LoggingConfig.LogGroup as string);
    expect(fn.Condition).toBe("IsAcademicStage");
    expect(group.Condition).toBe("IsAcademicStage");
  });

  it("ningún otro grupo de logs está condicionado", () => {
    const conditional = logGroups()
      .filter(([, g]) => g.Condition)
      .map(([name]) => name);
    expect(conditional).toEqual(["SimulateDonationLogGroup"]);
  });
});

describe("CloudTrail", () => {
  const trail = () => resource("Trail");

  it("hay exactamente un trail, activo y con validación de integridad de los archivos", () => {
    expect(resourcesOfType("AWS::CloudTrail::Trail")).toHaveLength(1);
    expect(trail().Properties).toMatchObject({ IsLogging: true, EnableLogFileValidation: true });
  });

  it("es de una sola región (Free plan) y su nombre incluye el stage", () => {
    expect(trail().Properties.IsMultiRegionTrail).toBe(false);
    expect(trail().Properties.TrailName).toBe("secure-donations-${Stage}-trail");
  });

  it("escribe en un bucket propio y espera a que su política exista", () => {
    expect(trail().Properties.S3BucketName).toBe("TrailBucket");
    expect(trail().DependsOn).toBe("TrailBucketPolicy");
  });

  describe("bucket de CloudTrail", () => {
    const bucket = () => resource("TrailBucket").Properties;

    it("es privado, sin ACL y cifrado, con expiración de los registros", () => {
      expect(bucket().PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
      expect(bucket().OwnershipControls.Rules).toEqual([
        { ObjectOwnership: "BucketOwnerEnforced" },
      ]);
      expect(bucket().BucketEncryption).toBeDefined();
      expect(bucket().LifecycleConfiguration.Rules[0].ExpirationInDays).toBeLessThanOrEqual(365);
    });

    it("la política solo concede a cloudtrail.amazonaws.com, limitada a ESTE trail, y deniega sin TLS", () => {
      const statements = asList<any>(
        resource("TrailBucketPolicy").Properties.PolicyDocument.Statement,
      );
      const allows = statements.filter((s) => s.Effect === "Allow");
      expect(allows).toHaveLength(2);
      for (const allow of allows) {
        expect(allow.Principal).toEqual({ Service: "cloudtrail.amazonaws.com" });
        expect(allow.Condition.StringEquals["AWS:SourceArn"]).toContain(
          ":trail/secure-donations-${Stage}-trail",
        );
      }
      expect(allows.map((s) => s.Action).sort()).toEqual(["s3:GetBucketAcl", "s3:PutObject"]);
      const write = allows.find((s) => s.Action === "s3:PutObject")!;
      expect(write.Resource).toBe("${TrailBucket.Arn}/AWSLogs/${AWS::AccountId}/*");
      expect(write.Condition.StringEquals["s3:x-amz-acl"]).toBe("bucket-owner-full-control");
      const deny = statements.find((s) => s.Effect === "Deny")!;
      expect(deny.Condition).toEqual({ Bool: { "aws:SecureTransport": "false" } });
    });

    it("el nombre del trail en la política coincide con el del trail (sin dependencia circular)", () => {
      expect(JSON.stringify(resource("TrailBucketPolicy").Properties)).not.toContain('"Trail"');
      expect(template.Resources.Trail).toBeDefined();
    });
  });
});
