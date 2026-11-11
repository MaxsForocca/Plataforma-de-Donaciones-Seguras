# Implementation Plan: Plataforma de Donaciones Seguras — Núcleo (EP-01, EP-02, EP-03 y alta mínima de proyectos)

**Branch**: `001-secure-donations-core` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-secure-donations-core/spec.md`

**Note**: This plan is derived from `design.md`, the active feature specification, and the project constitution.

## Summary

Implementar una aplicación web académica con SPA React y API serverless en AWS para descubrir
proyectos, autenticar usuarios, autorizar por rol y ownership, registrar donaciones simuladas con
idempotencia atómica y consultar indicadores agregados públicos. El backend se organiza en los
módulos `projects`, `donations`, `authz` y `audit`; la persistencia usa cuatro tablas DynamoDB
(`Projects`, `Donations`, `Idempotency`, `AuditEvents`) y la API se documenta como OpenAPI 3.1 sobre
API Gateway HTTP API con JWT authorizer de Cognito.

## Technical Context

**Language/Version**: TypeScript 7.0.x; Node.js 24 (`nodejs24.x`) en Lambda; navegadores modernos.

**Primary Dependencies**: React 19.3 + React DOM; Vite 8.3; Tailwind CSS 4; React Router 8; React
Hook Form 7; Zod 4; TanStack Query 5; oidc-client-ts; AWS SDK v3 para DynamoDB; AWS SAM/CloudFormation.
No se permite Bootstrap ni Next.js.

**Storage**: Amazon DynamoDB on-demand con cuatro tablas: `Projects`, `Donations`, `Idempotency` y
`AuditEvents`; S3 privado + CloudFront con OAC para la SPA.

**Testing**: Vitest 5 + Testing Library; pruebas de contrato con Bruno/Postman; pruebas negativas de
seguridad; ESLint 10 + Prettier 3 + typecheck; CI en GitHub Actions.

**Target Platform**: AWS Lambda `nodejs24.x`; API Gateway HTTP API; Amazon Cognito User Pool; DynamoDB;
S3 + CloudFront; CloudWatch Logs y CloudTrail. Región única `us-east-1` en AWS Free plan.

**Project Type**: Monorepo de aplicación web (frontend SPA + backend serverless + infraestructura IaC).

**Performance Goals**: Con 50 proyectos, al menos el 95% de las consultas públicas de catálogo y
detalle responde en ≤ 1.5 s desde un cliente cercano a la región, excluyendo cold start.

**Constraints**: Zero Trust estricto; identidad y roles solo desde claims verificados; dinero
exclusivamente en céntimos enteros; idempotencia atómica con `TransactWriteItems`; access tokens de
≤ 15 min; sin pagos reales; sin datos de tarjeta; sin Bootstrap ni Next.js; una sola región y AWS Free
plan; logs con retención de 14 días.

**Scale/Scope**: Equipo de 4–5 integrantes, 1 semana calendario, 4 roles (DONANTE, GESTOR, AUDITOR,
visitante), 9 endpoints HTTP, 4 tablas DynamoDB y hasta 50 proyectos de prueba.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Gate | Resultado |
|---|---|---|
| I. Zero Trust estricto | JWT authorizer valida firma, emisor, expiración, audiencia/`client_id` y scopes exigidos en todas las rutas protegidas (los ID tokens no portan esos scopes y se rechazan); `authz` verifica además `token_use=access` y deriva `sub` y grupos solo de claims; RBAC y ownership en backend; roles IAM por función. | PASS |
| II. Prohibición de Bootstrap y Next.js | Stack React + Vite + Tailwind; CI falla si aparecen `bootstrap` o `next` en manifiestos, lockfile o imports. | PASS |
| III. Dinero en céntimos enteros | `amountCents`, `goalAmountCents` y `confirmedAmountCents` son enteros; Zod rechaza flotantes; DynamoDB usa tipo N; formato PEN solo en presentación. | PASS |
| IV. Idempotencia atómica | `POST /v1/donations` exige `Idempotency-Key`; `TransactWriteItems` escribe clave, donación, condición de proyecto y evento de auditoría en una sola operación condicionada. | PASS |
| V. Tokens de corta duración | Cognito emite access tokens de ≤ 15 min; refresh revocable; SPA guarda tokens en memoria y revoca al cerrar sesión. | PASS |

No hay violaciones de la constitución. Re-evaluación post-diseño (Phase 1): PASS; `data-model.md`,
`contracts/openapi.yaml` y `quickstart.md` conservan los cinco principios, el mínimo privilegio, el
dinero entero, la idempotencia atómica y los tokens cortos. La sección de Complexity Tracking queda
vacía.

## Project Structure

### Documentation (this feature)

```text
specs/001-secure-donations-core/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── openapi.yaml
│   └── README.md
├── checklists/
└── spec.md
```

### Source Code (repository root)

```text
secure-donations-2026/
├── package.json                  # npm workspaces raíz
├── package-lock.json
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── pages/
│   │   │   ├── CatalogPage.tsx
│   │   │   ├── ProjectDetailPage.tsx
│   │   │   ├── LoginCallbackPage.tsx
│   │   │   ├── DonationPage.tsx
│   │   │   ├── SimulationPage.tsx
│   │   │   └── MyDonationsPage.tsx
│   │   ├── components/
│   │   ├── auth/                 # oidc-client-ts, PKCE, tokens en memoria
│   │   ├── services/             # cliente API y TanStack Query
│   │   └── main.tsx
│   └── test/
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── projects/             # catálogo, detalle, stats, alta y publicación
│   │   ├── donations/            # intención, simulación, historial y lectura por id
│   │   ├── authz/                # RBAC, ownership y principal desde claims
│   │   ├── audit/                # eventos de auditoría y logs estructurados
│   │   └── shared/               # configuración, errores, DynamoDB, idempotencia, respuesta
│   └── test/
│       ├── unit/
│       ├── integration/
│       └── contract/
├── packages/
│   └── shared/                   # esquemas Zod, tipos y contratos compartidos
├── infra/
│   ├── template.yaml             # AWS SAM, stages y permisos IAM
│   └── samconfig.toml
├── scripts/
│   └── seed.ts                   # datos semilla PUBLICADO y BORRADOR
├── policies/                     # Cedar para HU-12 (extensión, no MVP)
├── docs/
│   ├── api.yaml                  # derivado de contracts/openapi.yaml
│   └── threat-model.md
├── evidence/
├── .github/workflows/ci.yml
├── requirements.md
├── design.md
├── README.md
└── AI_USAGE.md
```

**Structure Decision**: Se usa un monorepo con npm workspaces (`frontend`, `backend`,
`packages/shared`). `packages/shared` concentra esquemas Zod, tipos y el sobre de error reutilizados
por ambos lados; `backend/src/shared` conserva utilidades exclusivas del backend (cliente DynamoDB,
logger, configuración y transacciones). `infra/` no es un workspace de aplicación. Esta estructura
refina la propuesta de `design.md` §8 para evitar duplicar contratos entre frontend y backend.

## Architecture and Module Responsibilities

### Frontend

- SPA React 19 + Vite + Tailwind; React Router para rutas públicas y protegidas.
- Login con Authorization Code + PKCE mediante oidc-client-ts; tokens solo en memoria (el
  `userStore` usa `InMemoryWebStorage`, nunca `localStorage` ni `sessionStorage`).
- TanStack Query para catálogo, detalle, estadísticas, historial y mutaciones.
- React Hook Form + Zod para validación de UX; la autorización nunca se decide en la SPA.
- Vistas: catálogo, detalle con indicadores, callback de login, formulario de donación, simulación
  académica con aviso obligatorio e historial propio.
- Sin Bootstrap, sin Next.js y sin SSR.

### Backend

- `projects`: lista pública publicado vía GSI, detalle público, estadísticas públicas, alta de
  BORRADOR por GESTOR y publicación por GESTOR. Cada operación tiene handler y repositorio.
- `donations`: creación idempotente, simulación académica, historial propio y lectura individual con
  ownership. Las escrituras monetarias confirman estados y agregados en una transacción.
- `authz`: construye el principal desde el contexto del authorizer (`sub`, `cognito:groups`, scopes),
  aplica RBAC y ownership contra el recurso persistido y expone guards reutilizables. No lee identidad
  ni roles del body, query o cabeceras del cliente.
- `audit`: emite `AuditEvent` y logs JSON con `requestId`; se usa en creación/publicación de proyectos
  y en creación/confirmación/rechazo de donaciones.
- `shared`: configuración por entorno, cliente DynamoDB, errores uniformes, utilidades de respuesta,
  canonicalización JSON, hash de idempotencia y validación Zod.

### Lambda and IAM split

Una función Lambda por caso de uso, con rol IAM mínimo:

| Función | Tablas / acciones |
|---|---|
| `listProjectsFn` | `Projects`: Query GSI |
| `getProjectFn` | `Projects`: GetItem |
| `getProjectStatsFn` | `Projects`: GetItem |
| `createProjectFn` | `Projects`: PutItem; `AuditEvents`: PutItem |
| `publishProjectFn` | `Projects`: UpdateItem; `AuditEvents`: PutItem |
| `createDonationFn` | `Projects`: GetItem (lectura previa) y ConditionCheck; `Donations`: PutItem; `Idempotency`: PutItem; `AuditEvents`: PutItem |
| `simulateDonationFn` | `Donations`: GetItem (lectura previa) y UpdateItem; `Projects`: UpdateItem; `AuditEvents`: PutItem |
| `listMyDonationsFn` | `Donations`: Query GSI |
| `getDonationFn` | `Donations`: GetItem |

`GET /v1/audit` (HU-10) queda fuera del MVP; el módulo `audit` solo escribe eventos.

## Data and Key Design

Los detalles completos están en [data-model.md](./data-model.md).

| Tabla | PK | SK | Índices / TTL | Uso |
|---|---|---|---|---|
| `Projects` | `projectId` (S) | — | GSI `status-createdAt` (`status`, `createdAt`) | Catálogo, detalle, estadísticas, publicación |
| `Donations` | `donationId` (S) | — | GSI `donorSub-createdAt` (`donorSub`, `createdAt`) | Historial y lectura por propietario |
| `Idempotency` | `pk` (S) = `donorSub#createDonation#idempotencyKey` | — | TTL `expiresAt` (24 h) | Repetición segura de donaciones |
| `AuditEvents` | `eventType` (S) | `timestamp#eventId` (S) | — | Trazabilidad y futura consulta HU-10 |

Reglas clave:

- Todos los importes son enteros `N` en céntimos de PEN.
- Antes de transaccionar, la creación de donación lee el proyecto con `GetItem` (`ConsistentRead`):
  si no existe responde 404 sin abrir la transacción (el 404 no proviene de una transacción
  cancelada). Si existe, continúa y la condición de la transacción decide el 409 por proyecto no
  público.
- La creación de donación usa `TransactWriteItems` con: `Put Idempotency` condicionado a
  `attribute_not_exists(pk)`, `Put Donation` condicionado a `attribute_not_exists(donationId)`,
  `ConditionCheck Project` con `status = PUBLICADO` y `Put AuditEvent`.
- Antes de transaccionar, la simulación lee la donación con `GetItem` (`ConsistentRead`): si no
  existe o su `donorSub` no coincide con el `sub` autenticado responde 404 sin abrir la transacción;
  una cancelación posterior de la transacción (estado ya terminal o carrera) responde 409.
- La simulación usa `TransactWriteItems`: `Update Donation` condicionado a
  `status = PENDIENTE_SIMULACION` y `donorSub = :sub`; si confirma, `Update Project` con
  `ADD confirmedAmountCents :amount`; siempre `Put AuditEvent`.
- Si la transacción de creación se cancela, se lee el registro de idempotencia: mismo `payloadHash`
  devuelve la respuesta almacenada y hash distinto devuelve 409. La condición de proyecto no público
  también devuelve 409.
- Las lecturas por clave primaria posteriores a una escritura propia usan `ConsistentRead`.

## API Contracts

El contrato canónico está en [contracts/openapi.yaml](./contracts/openapi.yaml) (OpenAPI 3.1, con
esquemas JSON embebidos). `docs/api.yaml` se derivará de ese archivo durante la implementación.

| Método | Ruta | Acceso | Módulo | Respuestas |
|---|---|---|---|---|
| GET | `/v1/projects` | Público | `projects` | 200 / 500 |
| GET | `/v1/projects/{projectId}` | Público | `projects` | 200 / 404 / 500 |
| GET | `/v1/projects/{projectId}/stats` | Público | `projects` | 200 / 404 / 500 |
| POST | `/v1/projects` | `api/projects.write` + GESTOR | `projects` | 201 / 400 / 401 / 403 / 500 |
| PATCH | `/v1/projects/{projectId}/publish` | `api/projects.write` + GESTOR | `projects` | 200 / 401 / 403 / 404 / 409 / 500 |
| POST | `/v1/donations` | `api/donations.write` + DONANTE; `Idempotency-Key` | `donations` | 201 / 400 / 401 / 403 / 404 / 409 / 500 |
| POST | `/v1/donations/{donationId}/simulate` | `api/donations.write` + DONANTE propietario; solo stage `academic` | `donations` | 200 / 400 / 401 / 403 / 404 / 409 / 500 |
| GET | `/v1/donations/me` | `api/donations.read` + DONANTE | `donations` | 200 / 401 / 500 |
| GET | `/v1/donations/{donationId}` | `api/donations.read` + DONANTE propietario | `donations` | 200 / 401 / 403 / 404 / 500 |

Decisiones de contrato:

- Se adopta la ruta versionada y el verbo `PATCH` de `design.md` para publicar; la operación funcional
  es la publicación mínima solicitada en la especificación.
- Se añade `GET /v1/donations/{donationId}` para cubrir CA-07.2/T09 con ownership; un acceso ajeno
  responde 404 para no revelar existencia.
- Error uniforme `{ code, message, requestId }`, sin detalles internos.
- `POST /v1/donations` acepta `Idempotency-Key` UUID y compara el JSON completo canónico; los campos
  extra forman parte de la huella de idempotencia y no de la identidad.
- `GET /v1/audit` se documenta como endpoint diferido (HU-10) y no forma parte del contrato MVP.

## High-Level Implementation Sequence

1. **Fundación**: workspaces, TypeScript, lint/typecheck, CI, SAM base, Cognito, tablas DynamoDB,
   `packages/shared` y utilidades de error/log.
2. **Proyectos y autorización**: handlers de catálogo, detalle, estadísticas, alta y publicación;
   `authz` con RBAC/ownership; `audit` para creación/publicación; datos semilla.
3. **Donaciones**: creación idempotente, simulación académica, historial y lectura individual;
   transacciones condicionadas y pruebas de concurrencia.
4. **Frontend**: rutas, login PKCE en memoria, catálogo, detalle, donación, simulación, historial y
   estados vacíos/error.
5. **Endurecimiento**: pruebas negativas T01–T14, contrato OpenAPI, accesibilidad 375 px/WCAG 2.2 AA,
   rendimiento con 50 proyectos, revisión IAM, documentación y limpieza.

## Complexity Tracking

No hay violaciones que justificar. La arquitectura usa cuatro tablas DynamoDB y funciones Lambda
separadas por caso de uso para respetar el mínimo privilegio y las operaciones transaccionales
requeridas por la constitución.
