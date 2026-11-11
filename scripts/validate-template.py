#!/usr/bin/env python3
"""Valida infra/template.yaml SIN AWS: transforma la plantilla SAM para cada stage y comprueba
invariantes de seguridad sobre el resultado (hosting privado, cabeceras, throttling, retención de
logs, CloudTrail y que la ruta de simulación solo exista en `academic`).

Requisitos (solo desarrollo):  pip install cfn-lint aws-sam-translator
Uso:                           python scripts/validate-template.py
No usa credenciales: solo necesita una región para el traductor (AWS_DEFAULT_REGION).
"""
from __future__ import annotations

import copy
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")  # solo la región; no hay llamadas a AWS

from samtranslator.translator.transform import transform  # noqa: E402
from samtranslator.yaml_helper import yaml_parse  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "infra" / "template.yaml"
SIMULATE_PATH = "/v1/donations/{donationId}/simulate"

failures: list[str] = []


def check(condition: bool, message: str) -> None:
    print(f"  {'OK ' if condition else 'FALLA'} {message}")
    if not condition:
        failures.append(message)


class _NoManagedPolicies:
    def load(self) -> dict:
        return {"AWSLambdaBasicExecutionRole": "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"}


def resolve(node, stage: str):
    """Resuelve los Fn::If de la condición IsAcademicStage para un stage."""
    if isinstance(node, dict) and "Fn::If" in node:
        condition, yes, no = node["Fn::If"]
        return resolve(yes if (condition == "IsAcademicStage" and stage == "academic") else no, stage)
    return node


def validate(stage: str) -> None:
    print(f"\n== Stage {stage}")
    template = yaml_parse(TEMPLATE.read_text(encoding="utf-8"))
    template["Globals"]["Function"]["CodeUri"] = "s3://bucket/key"  # `sam build` lo reemplaza
    parameters = {
        "Stage": stage,
        "AllowedOrigins": ["http://localhost:5173"],
        "CallbackUrls": ["http://localhost:5173/callback"],
        "LogoutUrls": ["http://localhost:5173/"],
        "AWS::Region": "us-east-1",
        "AWS::AccountId": "000000000000",
    }
    out = transform(copy.deepcopy(template), parameters, _NoManagedPolicies())
    resources = out["Resources"]
    by_type: dict[str, list[tuple[str, dict]]] = {}
    for name, resource in resources.items():
        by_type.setdefault(resource["Type"], []).append((name, resource))
    check(True, f"la transformación SAM produjo {len(resources)} recursos")

    # --- Ruta de simulación solo en academic ------------------------------------------------------
    api = next(r for n, r in resources.items() if r["Type"] == "AWS::ApiGatewayV2::Api")
    paths = api["Properties"]["Body"]["paths"]
    live = {}
    for path, methods in paths.items():
        methods = resolve(methods, stage)
        for verb, spec in (methods or {}).items():
            spec = resolve(spec, stage)
            if isinstance(spec, dict):
                live[f"{verb.upper()} {path}"] = spec
    simulate = f"POST {SIMULATE_PATH}"
    check((simulate in live) == (stage == "academic"), f"la ruta de simulación {'existe' if stage == 'academic' else 'NO existe'} en {stage}")
    check(
        all(spec.get("security") for route, spec in live.items() if route.startswith(("POST", "PATCH"))),
        "toda ruta de escritura exige el authorizer JWT",
    )

    # --- Throttling y registro de acceso del stage -------------------------------------------------
    stages = [r for _, r in by_type.get("AWS::ApiGatewayV2::Stage", [])]
    check(len(stages) == 1, "hay un único stage de la API")
    props = stages[0]["Properties"]
    settings = props.get("DefaultRouteSettings", {})
    check(settings.get("ThrottlingRateLimit", 0) > 0 and settings.get("ThrottlingBurstLimit", 0) > 0, f"throttling del stage: {settings}")
    check("DestinationArn" in props.get("AccessLogSettings", {}), "el stage registra el acceso en CloudWatch Logs")
    log_format = props.get("AccessLogSettings", {}).get("Format", "")
    check(not any(token in log_format for token in ("sourceIp", "authorizer", "identity", "requestHeaders")), "el registro de acceso no incluye IP, claims ni cabeceras")

    # --- Retención de 14 días de TODOS los grupos de logs, y cada función usa el suyo -----------
    groups = by_type.get("AWS::Logs::LogGroup", [])
    check(bool(groups) and all(r["Properties"].get("RetentionInDays") == 14 for _, r in groups), f"{len(groups)} grupos de logs con retención de 14 días")
    functions = by_type.get("AWS::Lambda::Function", [])
    check(bool(functions) and all("LogGroup" in r["Properties"].get("LoggingConfig", {}) for _, r in functions), f"{len(functions)} funciones Lambda con su propio grupo de logs")
    check(resources["SimulateDonationFunction"].get("Condition") == "IsAcademicStage", "la función de simulación está condicionada a IsAcademicStage")

    # --- S3: todos los buckets privados y cifrados --------------------------------------------------
    buckets = by_type.get("AWS::S3::Bucket", [])
    check(len(buckets) == 2, f"{len(buckets)} buckets (SPA y CloudTrail)")
    for name, bucket in buckets:
        block = bucket["Properties"].get("PublicAccessBlockConfiguration", {})
        check(all(block.get(k) is True for k in ("BlockPublicAcls", "BlockPublicPolicy", "IgnorePublicAcls", "RestrictPublicBuckets")), f"{name}: bloqueo de acceso público completo")
        check("BucketEncryption" in bucket["Properties"], f"{name}: cifrado en reposo")

    # --- CloudFront: OAC, HTTPS, cabeceras de seguridad ---------------------------------------------
    distribution = by_type["AWS::CloudFront::Distribution"][0][1]["Properties"]["DistributionConfig"]
    behavior = distribution["DefaultCacheBehavior"]
    check(behavior["ViewerProtocolPolicy"] == "redirect-to-https", "CloudFront redirige a HTTPS")
    check(all("OriginAccessControlId" in o for o in distribution["Origins"]), "todos los orígenes usan OAC (sin OAI heredado)")
    check(set(behavior["AllowedMethods"]) == {"GET", "HEAD"}, "CloudFront solo permite GET y HEAD")
    headers = by_type["AWS::CloudFront::ResponseHeadersPolicy"][0][1]["Properties"]["ResponseHeadersPolicyConfig"]["SecurityHeadersConfig"]
    check(headers["StrictTransportSecurity"]["AccessControlMaxAgeSec"] >= 31_536_000, "HSTS de al menos un año")
    check(headers["ContentTypeOptions"]["Override"] is True, "X-Content-Type-Options: nosniff")
    check("ReferrerPolicy" in headers, "Referrer-Policy configurada")
    csp = json.dumps(headers["ContentSecurityPolicy"]["ContentSecurityPolicy"])
    check("script-src 'self'" in csp and "unsafe-inline" not in csp and "unsafe-eval" not in csp, "CSP sin 'unsafe-inline' ni 'unsafe-eval'")
    check("frame-ancestors 'none'" in csp and "object-src 'none'" in csp, "CSP: frame-ancestors y object-src cerrados")

    # --- CloudTrail --------------------------------------------------------------------------------
    trail = by_type["AWS::CloudTrail::Trail"][0][1]["Properties"]
    check(trail["IsLogging"] is True and trail["EnableLogFileValidation"] is True, "CloudTrail activo con validación de archivos")


def main() -> int:
    print("== cfn-lint")
    exe = shutil.which("cfn-lint") or str(Path(sys.executable).parent / ("cfn-lint.exe" if os.name == "nt" else "cfn-lint"))
    lint = subprocess.run([exe, str(TEMPLATE)], capture_output=True, text=True)
    print(lint.stdout.strip() or "  sin hallazgos")
    if lint.returncode != 0:
        failures.append("cfn-lint reportó hallazgos")
    for stage in ("academic", "dev"):
        validate(stage)
    print("\nRESULTADO:", "OK" if not failures else f"{len(failures)} fallo(s): {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
