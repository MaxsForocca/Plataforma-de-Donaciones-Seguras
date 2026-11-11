# Plataforma de Donaciones Seguras

**Proyecto Académico:** UNSA — Tópicos Avanzados en Ingeniería de Software (TAIS, Práctica 04)  
**Arquitectura:** Serverless en AWS (SPA React 19 + API Gateway HTTP API + AWS Lambda + DynamoDB + Cognito + CloudFront)  
**Enfoque de Seguridad:** Zero Trust estricto (NIST SP 800-207)  
**Metodología:** Desarrollo Guiado por Especificaciones (SDD) con GitHub Spec Kit  
**Estado:** Fases 1 a 12 completadas (117 de 117 tareas, 1965 pruebas pasando)

> **⚠️ AVISO IMPORTANTE — NO HAY PAGOS REALES:**  
> Todas las donaciones gestionadas por esta plataforma son **estrictamente simuladas** con fines académicos. El sistema **no procesa cobros reales, no recauda fondos bancarios y nunca solicita ni almacena datos de tarjetas de crédito/débito, números CVV, cuentas bancarias ni documentos de identidad (DNI)**. Cualquier prueba debe realizarse con identidades y datos ficticios.

---

## 1. Documentación del Proyecto

- **Especificación y Plan SDD:**
  - [`constitution.md`](.specify/memory/constitution.md): Principios inmutables del proyecto.
  - [`spec.md`](specs/001-secure-donations-core/spec.md): Historias de usuario (US1 a US9), requisitos funcionales y criterios de aceptación (CA-01.1 a CA-11.2).
  - [`plan.md`](specs/001-secure-donations-core/plan.md): Arquitectura técnica, decisiones de diseño y stack tecnológico.
  - [`tasks.md`](specs/001-secure-donations-core/tasks.md): Desglose de las 117 tareas de implementación.
  - [`quickstart.md`](specs/001-secure-donations-core/quickstart.md): Guía de validación end-to-end con 20 escenarios de prueba.
- **Contratos de API:**
  - [`contracts/openapi.yaml`](specs/001-secure-donations-core/contracts/openapi.yaml) y [`docs/api.yaml`](docs/api.yaml): Especificación formal OpenAPI 3.1.
- **Seguridad y Evidencias:**
  - [`docs/threat-model.md`](docs/threat-model.md): Modelo de amenazas STRIDE y mapeo formal a NIST SP 800-207.
  - [`AI_USAGE.md`](AI_USAGE.md): Declaración ética de uso de asistentes de IA (OpenCode, Claude Code, Antigravity).
  - [`evidence/traceability.md`](evidence/traceability.md): Matriz de trazabilidad CA-01.1–CA-11.2 a pruebas automatizadas.
  - [`evidence/security-tests.md`](evidence/security-tests.md): Registro de pruebas de seguridad extremas (T01 a T14) y mutaciones.
  - [`evidence/iam-review.md`](evidence/iam-review.md): Auditoría de mínimo privilegio IAM sin comodines en `infra/template.yaml`.
  - [`evidence/quickstart-validation.md`](evidence/quickstart-validation.md): Validación de los 20 escenarios de quickstart.
  - [`evidence/accessibility.md`](evidence/accessibility.md): Auditoría de accesibilidad WCAG 2.2 AA y viewport móvil de 375 px.
  - [`evidence/performance.md`](evidence/performance.md): Medición de latencia de catálogo y detalle (p95 ≤ 1.5 s).
  - [`evidence/cleanup.md`](evidence/cleanup.md): Procedimiento paso a paso de desmantelamiento de recursos.

---

## 2. Stack Tecnológico y Reglas de la Constitución

- **Frontend:** React 19, Vite, Tailwind CSS 4, React Router, TanStack Query, React Hook Form, Zod, `oidc-client-ts`.
- **Backend:** Node.js 24, TypeScript ~6.0.3 en AWS Lambda, DynamoDB DocumentClient.
- **Seguridad e Identidad:** Amazon Cognito User Pool (Authorization Code Flow + PKCE S256, MFA TOTP obligatorio), API Gateway HTTP API con JWT Authorizer perimetral.
- **Almacenamiento:** Amazon DynamoDB (tablas `Projects`, `Donations`, `Idempotency`, `AuditEvents`).
- **Infraestructura como Código:** AWS SAM CLI (`infra/template.yaml`, `infra/samconfig.toml`).
- **Constitución del Proyecto:**
  1. *Zero Trust estricto:* El backend es la única fuente de verdad. Ni el navegador ni los inputs determinan identidades o roles.
  2. *Sin dependencias prohibidas:* **Prohibido Bootstrap y Next.js** en cualquier forma (verificado automáticamente por `npm run check-deps`).
  3. *Manejo monetario entero:* Todos los importes en céntimos enteros de Soles (`amountCents`, integer, entre 100 y 100000; moneda fija `PEN`). Prohibido punto flotante.
  4. *Idempotencia atómica:* Donaciones protegidas mediante huella SHA-256 canónica y `TransactWriteItems`. Replay exacto retorna 201; alteración retorna 409.
  5. *Tokens de corta duración:* Access tokens ≤ 15 minutos en memoria (nunca `localStorage` ni `sessionStorage`), refresh tokens revocables.

---

## 3. Estructura del Monorepo

```text
├── frontend/         # SPA React 19 + Tailwind CSS (workspace)
├── backend/          # Lambdas serverless, un handler desacoplado por caso de uso (workspace)
├── packages/shared/  # Esquemas Zod compartidos, tipos y serialización canónica SHA-256 (workspace)
├── infra/            # Plantilla AWS SAM (template.yaml) y configuración (samconfig.toml)
├── scripts/          # Validadores estáticos, scripts de semillas (seed.ts) y deploy de frontend
├── docs/             # Modelo de amenazas NIST SP 800-207 y contrato OpenAPI sincronizado (api.yaml)
├── evidence/         # Reportes de auditoría, trazabilidad, accesibilidad, IAM y pruebas T01–T14
└── specs/            # Artefactos del ciclo SDD generado con GitHub Spec Kit
```

---

## 4. Instalación y Verificación Local

```bash
# 1. Instalar dependencias fijadas por package-lock.json
npm ci

# 2. Verificar dependencias prohibidas (guardia de Bootstrap y Next.js)
npm run check-deps

# 3. Análisis estático y tipos
npm run lint
npm run typecheck

# 4. Ejecutar suite completa de pruebas (1965+ pruebas)
npm test

# 5. Validar contrato OpenAPI 3.1
npm run contract:validate

# 6. Compilar frontend de producción
npm run build
```

---

## 5. Demostración y Datos Semilla

Para validar la funcionalidad localmente con datos iniciales:
```bash
# Ejecutar verificación de fixtures de proyectos (modo dry-run sin escribir en AWS)
npm run seed -- --dry-run

# Iniciar servidor de desarrollo frontend
npm run dev --workspace frontend
```

---

## 6. Despliegue en AWS (Stage Académico)

El despliegue en AWS requiere credenciales de su propia cuenta de AWS Free Tier:

```bash
# 1. Construir artefactos con SAM
sam build --template infra/template.yaml

# 2. Desplegar en el stage 'academic' (habilita simulación de donaciones)
sam deploy --config-file infra/samconfig.toml --config-env academic

# 3. Publicar la SPA en S3 / CloudFront (privado con OAC)
npm run deploy:frontend -- --stage academic --execute
```

---

## 7. Limitaciones Conocidas y Tratamiento

1. **Donaciones Simuladas:** Proyecto académico sin integración con pasarelas de pago ni tarjetas reales.
2. **Ventana Residual de Revocación de Tokens:** API Gateway valida JWTs mediante claves públicas JWKS sin consultar revocaciones en tiempo real; el access token revocado expira en ≤ 15 minutos (mitigación documentada en `docs/threat-model.md`).
3. **MFA Global en User Pool:** Cognito exige MFA a nivel de User Pool, aplicándose a todos los usuarios autenticados.
4. **Escala y Paginación:** Catálogo público optimizado para hasta 50 proyectos (sin paginación; queries con parámetros de paginación devuelven 400).

---

## 8. Desmantelamiento y Limpieza de Recursos

Para evitar cargos residuales en AWS tras finalizar las evaluaciones:
```bash
# 1. Vaciar el bucket privado de CloudFront
aws s3 rm s3://<FRONTEND_BUCKET_NAME> --recursive

# 2. Eliminar la pila SAM completa
sam delete --stack-name donaciones-academic --no-prompts --region us-east-1

# 3. Consultar guía completa de verificación en:
# evidence/cleanup.md
```
