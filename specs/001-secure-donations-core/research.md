# Research: Plataforma de Donaciones Seguras — Núcleo

**Feature**: `001-secure-donations-core` | **Date**: 2026-11-09

## Resolved Decisions

### R-01 — Monorepo con workspaces

- **Decision**: Usar un monorepo npm con tres workspaces: `frontend`, `backend` y
  `packages/shared`. La infraestructura SAM vive en `infra/` y los scripts operativos en `scripts/`.
- **Rationale**: Permite reutilizar esquemas Zod, tipos y el sobre de error entre SPA y Lambda, fija
  una sola instalación reproducible con `package-lock.json` y mantiene separadas las dependencias de
  navegador, runtime y herramientas.
- **Alternatives considered**: Repositorios separados (rechazado por coordinación y duplicación de
  contratos); un único paquete sin workspaces (rechazado por mezclar dependencias de frontend y
  backend); shared dentro de `backend/src` (rechazado porque obliga al frontend a importar desde el
  workspace de backend).

### R-02 — Runtime, lenguaje y stack

- **Decision**: TypeScript 7.0.x; Node.js 24 `nodejs24.x`; React 19.3 + Vite 8.3 + Tailwind CSS 4;
  React Router 8; React Hook Form 7 + Zod 4; TanStack Query 5; oidc-client-ts; Vitest 5 + Testing
  Library; ESLint 10 + Prettier 3.
- **Rationale**: Es el stack verificado en `design.md` §2 y cumple la prohibición constitucional de
  Bootstrap y Next.js/SSR.
- **Alternatives considered**: Next.js/SSR (prohibido); Bootstrap (prohibido); otras versiones
  mayores solo si el equipo documenta una combinación estable e incompatible.

### R-03 — Modelo DynamoDB multi-tabla

- **Decision**: Cuatro tablas on-demand: `Projects`, `Donations`, `Idempotency` y `AuditEvents`;
  nombres físicos prefijados por stage (`${Stage}Projects`, etc.).
- **Rationale**: `design.md` §5 define accesos por tabla y las transacciones necesitan claves claras;
  el modelo multi-tabla simplifica permisos IAM por función y la legibilidad académica.
- **Alternatives considered**: Single-table design (rechazado por mayor complejidad de claves y de
  políticas IAM para el alcance); tablas adicionales (rechazado por YAGNI).

### R-04 — Claves y patrones de acceso

- **Decision**:
  - `Projects`: PK `projectId`; GSI `status-createdAt` para catálogo publicado ordenado por fecha.
  - `Donations`: PK `donationId`; GSI `donorSub-createdAt` para historial propio.
  - `Idempotency`: PK `donorSub#createDonation#idempotencyKey`; TTL `expiresAt` de 24 h.
  - `AuditEvents`: PK `eventType`; SK `timestamp#eventId`.
- **Rationale**: Cubre catálogo, detalle, historial, idempotencia y auditoría sin scans; las claves
  coinciden con `design.md` §5 y con los criterios de aceptación.
- **Alternatives considered**: GSI por `projectId` en donaciones (rechazado: el agregado se mantiene
  en `Project.confirmedAmountCents`); PK por `requestId` en auditoría (rechazado: la consulta de HU-10
  es por tipo y fecha).

### R-05 — Idempotencia atómica y canonicalización

- **Decision**: `POST /v1/donations` exige `Idempotency-Key` UUID y ejecuta un único
  `TransactWriteItems` con `Put Idempotency` (`attribute_not_exists(pk)`), `Put Donation`,
  `ConditionCheck Project` (`status = PUBLICADO`) y `Put AuditEvent`. La huella se calcula sobre el
  JSON completo canónico (claves ordenadas, sin espacios insignificantes); cualquier campo extra o
  valor distinto produce hash distinto.
- **Rationale**: Cumple AD-05 y la constitución; evita doble conteo y carreras. La comparación
  canónica respeta la clarificación de la especificación del 2026-11-09.
- **Alternatives considered**: Lectura seguida de escritura (rechazado: no atómico); hash de bytes
  exactos (rechazado: frágil ante orden de claves); hash solo de `projectId` y `amountCents`
  (rechazado por la clarificación).

### R-06 — Autorización y confianza cero

- **Decision**: API Gateway HTTP API con JWT authorizer de Cognito valida firma, emisor, expiración,
  `client_id`, `token_use=access` y scopes. El módulo `authz` deriva `sub` y `cognito:groups` solo del
  contexto verificado, aplica RBAC/ownership contra DynamoDB y trata cualquier `donorSub`, rol o grupo
  del cliente como dato no confiable.
- **Rationale**: Cumple AD-01, AD-04 y la constitución; la SPA solo oculta controles por UX.
- **Alternatives considered**: Lambda authorizer con lista de revocación (diferido: agrega
  complejidad y no es necesario para el MVP); confiar en el guard de UI (rechazado por inseguro).

### R-07 — Tokens y sesión

- **Decision**: Authorization Code + PKCE; access token de 5–15 min; refresh token revocable; tokens
  en memoria; cierre de sesión limpia memoria y revoca refresh. Se documenta que un access token
  revocado sigue válido hasta expirar.
- **Rationale**: Cumple AD-07, CA-03.3/CA-03.4 y la limitación conocida de API Gateway.
- **Alternatives considered**: Tokens en `localStorage` (rechazado por XSS); access tokens de larga
  vida (rechazado); lista de revocación en authorizer (diferido).

### R-08 — Rutas de proyectos

- **Decision**: `POST /v1/projects` crea BORRADOR y `PATCH /v1/projects/{projectId}/publish` publica,
  siguiendo `design.md` §4. La publicación mínima solicitada se implementa en backend y no incluye
  edición avanzada ni panel administrativo.
- **Rationale**: Mantiene coherencia con el contrato de referencia y con la semántica de actualización
  parcial; evita dos verbos para la misma transición.
- **Alternatives considered**: `POST /v1/projects/{projectId}/publish` (no adoptado porque
  `design.md` define PATCH); incluir CRUD completo de proyectos (rechazado por alcance).

### R-09 — Lectura individual de donaciones

- **Decision**: Añadir `GET /v1/donations/{donationId}` protegido y con ownership. Un acceso ajeno
  responde 404 para no revelar existencia.
- **Rationale**: `design.md` lista el historial propio, pero CA-07.2/T09 requieren demostrar el
  rechazo al consultar una donación ajena; el endpoint permite la prueba BOLA directa.
- **Alternatives considered**: Usar solo `POST /simulate` para probar ownership (insuficiente para
  "consultar"); devolver 403 en acceso ajeno (válido, pero 404 evita enumeración).

### R-10 — Indicadores agregados públicos

- **Decision**: `Project.confirmedAmountCents` es el agregado autoritativo y se actualiza solo en la
  transición válida a CONFIRMADA_SIMULADA. Catálogo, detalle y `GET /stats` muestran solo ese valor en
  formato PEN; nunca exponen `donorSub` ni registros individuales.
- **Rationale**: Cumple CA-09.1/CA-09.2, excluye pendientes y rechazadas y evita scans o cálculos
  inconsistentes en lectura.
- **Alternatives considered**: Sumar donaciones en cada lectura (rechazado por coste y consistencia);
  exponer un listado de donaciones en la vista pública (rechazado por privacidad).

### R-11 — Contratos y pruebas

- **Decision**: `contracts/openapi.yaml` es la fuente canónica OpenAPI 3.1 con esquemas JSON
  embebidos. Las pruebas de contrato usan Bruno/Postman; las unitarias/integración usan Vitest. El CI
  ejecuta lint, typecheck, tests, build y `npm audit`.
- **Rationale**: Permite validar endpoints, códigos de error y esquemas sin acoplar los tests a la
  implementación; cumple RNF-HU-08 y las puertas de calidad de la constitución.
- **Alternatives considered**: Generar el contrato desde anotaciones (rechazado por dependencia
  adicional); mantener solo Postman (rechazado por falta de esquema formal).

### R-12 — Observabilidad y auditoría

- **Decision**: Logs JSON con `requestId`, acción, resultado, código HTTP y duración; retención 14
  días en CloudWatch; CloudTrail para infraestructura; `AuditEvents` para creación/publicación de
  proyectos y operaciones de donación. `GET /v1/audit` queda diferido (HU-10).
- **Rationale**: Cumple CA-08.3, RNF-HU-07 y el requisito de no registrar secretos ni datos
  personales.
- **Alternatives considered**: Logs de texto libre (rechazado por baja trazabilidad); auditoría solo
  en logs (rechazado porque CA-08.3 exige eventos consultables en el futuro).

## Unresolved Clarifications

Ninguna. Todas las decisiones de `Technical Context` se resuelven con `design.md`, la especificación
activa y la constitución; no quedan aclaraciones pendientes ni marcadores sin resolver.
