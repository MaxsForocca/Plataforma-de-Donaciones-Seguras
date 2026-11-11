---
description: "Task list for Plataforma de Donaciones Seguras — Núcleo"
---

# Tasks: Plataforma de Donaciones Seguras — Núcleo (EP-01, EP-02, EP-03 y alta mínima de proyectos)

**Input**: Design documents from `specs/001-secure-donations-core/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/openapi.yaml, quickstart.md

**Tests**: Se incluyen tareas de prueba porque la especificación exige cobertura de CA-01.1 a CA-09.2 y
CA-11.1 a CA-11.2, y la constitución exige lint, typecheck, pruebas y CI en cada PR.

**Organization**: Tareas agrupadas por historia de usuario para permitir implementación y prueba
independientes. Los identificadores CA se conservan literalmente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede ejecutarse en paralelo (archivos distintos, sin dependencia de tareas incompletas)
- **[Story]**: Historia de usuario (`US1`–`US9`)
- Todas las tareas incluyen rutas de archivo concretas

## Path Conventions

- Monorepo npm workspaces: `frontend/`, `backend/`, `packages/shared/`
- Infraestructura: `infra/template.yaml`
- Scripts: `scripts/`
- Contratos y documentación: `specs/001-secure-donations-core/contracts/`, `docs/`
- Pruebas backend: `backend/test/{unit,integration,contract}/`
- Pruebas frontend: `frontend/test/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Inicializar el monorepo, tooling, SAM y estructura base.

- [X] T001 Create root npm workspaces configuration and shared TypeScript base in `package.json`, `package-lock.json`, `tsconfig.base.json` and `.gitignore`
- [X] T002 [P] Initialize frontend workspace with React 19.3, Vite 8.3, Tailwind CSS 4, React Router 8, React Hook Form 7, Zod 4, TanStack Query 5, oidc-client-ts, Vitest 5 and Testing Library in `frontend/package.json`
- [X] T003 [P] Initialize backend workspace with TypeScript, AWS SDK v3 DynamoDB clients, Zod 4, Vitest 5 and Node 24 types in `backend/package.json`
- [X] T004 [P] Initialize `packages/shared/package.json` with exports for Zod schemas, domain types and the error envelope
- [X] T005 Create source directory skeleton for `frontend/src/{pages,components,auth,services}`, `backend/src/{projects,donations,authz,audit,shared}`, `backend/test/{unit,integration,contract}`, `packages/shared/src`, `infra/`, `scripts/`, `docs/` and `evidence/`
- [X] T006 [P] Configure ESLint 10, Prettier 3 and TypeScript project references in `eslint.config.js`, `.prettierrc` and workspace `tsconfig.json` files
- [X] T007 [P] Create CI workflow with lint, typecheck, unit/integration/contract tests, build and `npm audit` in `.github/workflows/ci.yml`
- [X] T008 [P] Create dependency guard that fails when `bootstrap` or `next` appear in manifests, lockfile or imports in `scripts/check-deps.mjs`
- [X] T009 Create SAM skeleton with `Stage` parameter, stack outputs and environment naming in `infra/template.yaml`
- [X] T010 [P] Create SAM deployment configuration for `academic` and non-academic stages in `infra/samconfig.toml`
- [X] T011 [P] Create `.env.example` and initial deploy/limitations README without secrets in `.env.example` and `README.md`
- [X] T012 [P] Create seed script entry point and fixture format for published/draft projects in `scripts/seed.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Infraestructura compartida que MUST completarse antes de cualquier historia.

**⚠️ CRITICAL**: Ninguna historia de usuario comienza hasta completar esta fase.

- [X] T013 [P] Define shared Zod schemas in `packages/shared/src/schemas.ts`: `title` 1–120 caracteres, `description` 1–2000 caracteres, `goalAmountCents` entero > 0, `amountCents` entero 100–100000, `currency` exactamente `PEN`, `status` de proyecto `BORRADOR|PUBLICADO`, `status` de donación `PENDIENTE_SIMULACION|CONFIRMADA_SIMULADA|RECHAZADA_SIMULADA` and error envelope `{ code, message, requestId }`
- [X] T014 [P] Implement canonical JSON serialization (sorted keys, no insignificant whitespace) and SHA-256 payload hashing in `packages/shared/src/canonical.ts`
- [X] T015 [P] Implement backend environment configuration for `STAGE`, table names, Cognito issuer/client and allowed origins in `backend/src/shared/config.ts`
- [X] T016 [P] Implement DynamoDB DocumentClient factory and table-name resolution in `backend/src/shared/dynamodb.ts`
- [X] T017 [P] Implement uniform HTTP response and error helpers with `{ code, message, requestId }` and no internal details in `backend/src/shared/http.ts`
- [X] T018 [P] Implement structured JSON logger with `requestId`, action, result, HTTP status and duration, excluding secrets and personal data, in `backend/src/shared/logger.ts`
- [X] T019 Implement idempotency helpers using PK `donorSub#createDonation#idempotencyKey`, `payloadHash` and TTL `expiresAt` of 24 h in `backend/src/shared/idempotency.ts`
- [X] T020 Complete audit module write path for `PROJECT_CREATED`, `PROJECT_PUBLISHED`, `DONATION_CREATED`, `DONATION_CONFIRMED`, `DONATION_REJECTED` and `ACCESS_DENIED` in `backend/src/audit/repository.ts`
- [X] T021 Implement authz principal extraction from API Gateway authorizer context (`sub`, groups, scopes) with no trust in body/query/headers, and verify `token_use=access` as defense in depth, in `backend/src/authz/principal.ts`
- [X] T022 Implement RBAC and ownership guards for GESTOR, DONANTE and AUDITOR in `backend/src/authz/policies.ts`
- [X] T023 Define `Projects`, `Donations`, `Idempotency` and `AuditEvents` DynamoDB tables in `infra/template.yaml`: Projects PK `projectId` + GSI `status-createdAt`; Donations PK `donationId` + GSI `donorSub-createdAt`; Idempotency PK `pk` + TTL `expiresAt`; AuditEvents PK `eventType` + SK `timestamp#eventId`; on-demand billing
- [X] T024 Define Cognito User Pool, groups `DONANTE|GESTOR|AUDITOR`, app client with Authorization Code + PKCE, access token validity 5–15 min and TOTP MFA for GESTOR/AUDITOR in `infra/template.yaml`
- [X] T025 Define API Gateway HTTP API, Cognito JWT authorizer, scopes `api/projects.write`, `api/donations.write`, `api/donations.read` and `api/audit.read`, with `authorizationScopes` required on every protected route so ID tokens are rejected, in `infra/template.yaml`
- [X] T026 Define base Lambda functions and least-privilege IAM roles for public project reads and protected handlers in `infra/template.yaml`
- [X] T027 Add stage-conditional academic-only simulation route so the path does not exist outside `Stage=academic` in `infra/template.yaml`
- [X] T028 Create backend test harness for authorizer context, DynamoDB tables and fixtures in `backend/test/helpers/setup.ts`
- [X] T029 Implement reproducible seed data with at least one PUBLICADO project, one BORRADOR project and donations in PENDIENTE_SIMULACION, CONFIRMADA_SIMULADA and RECHAZADA_SIMULADA in `scripts/seed.ts`
- [X] T030 Implement frontend API client with bearer token injection and QueryClient provider in `frontend/src/services/apiClient.ts` and `frontend/src/services/queryClient.ts`
- [X] T031 Implement OIDC auth provider with Authorization Code + PKCE, in-memory tokens (`userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() })`, never `localStorage`/`sessionStorage`) and revoke-on-logout in `frontend/src/auth/AuthProvider.tsx`
- [X] T032 Implement app shell, public/protected routes and UX-only protected route guard in `frontend/src/App.tsx` and `frontend/src/components/Layout.tsx`
- [X] T033 [P] Implement integer-cents to PEN display formatting without float arithmetic in `frontend/src/services/money.ts`
- [X] T065 [P] Create test fixtures for published, draft and donation states in `backend/test/helpers/fixtures.ts`
- [X] T117 [P] Create minimal `frontend/index.html` and `frontend/src/main.tsx` (React root rendering the app shell, no Bootstrap/Next.js) so that `npm run build` succeeds

**Checkpoint**: Foundation ready — las historias pueden comenzar.

---

## Phase 3: User Story 1 - Descubrir proyectos publicados (Priority: P1) 🎯 MVP

**Goal**: Catálogo público de proyectos PUBLICADO con meta, suma confirmada e indicadores agregados,
sin exponer donantes ni registros individuales.

**Independent Test**: Con datos semilla (publicado, borrador, donaciones pendientes/confirmadas/rechazadas),
abrir el catálogo como visitante y verificar que solo aparecen publicados, que la suma excluye
pendientes/rechazadas y que no se exponen donantes ni donaciones individuales.

### Tests for User Story 1

- [X] T034 [P] [US1] Unit test catalog mapping and only-PUBLICADO filtering in `backend/test/unit/projects/list.test.ts`
- [X] T035 [P] [US1] Unit test confirmed-sum excludes PENDIENTE_SIMULACION and RECHAZADA_SIMULADA in `backend/test/unit/projects/stats.test.ts`
- [X] T036 [P] [US1] Contract test `GET /v1/projects` returns 200 with only published summaries and no donor identifiers in `backend/test/contract/projects.list.test.ts`
- [X] T037 [P] [US1] Contract test `GET /v1/projects/{projectId}/stats` returns 200/404 with PEN aggregate fields and no donor records in `backend/test/contract/projects.stats.test.ts`
- [X] T038 [P] [US1] Integration test seeded catalog returns published projects and excludes drafts in `backend/test/integration/projects.catalog.test.ts`
- [X] T039 [P] [US1] Frontend test CatalogPage loading, empty, error and aggregate display in `frontend/test/CatalogPage.test.tsx`

### Implementation for User Story 1

- [X] T040 [US1] Implement project read repository for `listPublished`, `getProject` and aggregate reads in `backend/src/projects/repository.ts`
- [X] T041 [US1] Implement `listProjects` and `getProjectStats` handlers in `backend/src/projects/handlers/listProjects.ts` and `backend/src/projects/handlers/getProjectStats.ts`
- [X] T042 [US1] Wire catalog and stats routes with read-only IAM permissions in `infra/template.yaml`
- [X] T043 [US1] Implement CatalogPage with TanStack Query, loading/empty/error states and PEN formatting in `frontend/src/pages/CatalogPage.tsx`

**Checkpoint**: US1 funcional y verificable independientemente con datos semilla.

---

## Phase 4: User Story 3 - Iniciar y cerrar sesión (Priority: P1)

**Goal**: Autenticación con Authorization Code + PKCE, tokens de ≤ 15 min en memoria y cierre de sesión
con revocación de refresh.

**Independent Test**: Iniciar sesión con un usuario de prueba, acceder a una operación protegida,
cerrar sesión y verificar que el access token deja de estar disponible y que el refresh token se revoca.

### Tests for User Story 3

- [X] T044 [P] [US3] Integration test rejects missing, expired, tampered, foreign-client and ID tokens with 401 in `backend/test/integration/auth.tokens.test.ts`
- [X] T045 [P] [US3] Frontend test verifies tokens stay in memory, logout clears them and refresh revocation is invoked in `frontend/test/auth.test.tsx`

### Implementation for User Story 3

- [X] T046 [US3] Configure JWT authorizer route scopes and access token validity 5–15 min in `infra/template.yaml`
- [X] T047 [US3] Complete PKCE login/callback/logout flow in `frontend/src/auth/AuthProvider.tsx` and `frontend/src/pages/LoginCallbackPage.tsx`
- [X] T048 [US3] Implement UX-only protected route guard in `frontend/src/auth/ProtectedRoute.tsx`
- [X] T049 [US3] Document the access-token revocation limitation and short-lived mitigation in `docs/threat-model.md`

**Checkpoint**: US3 funcional y verificable independientemente.

---

## Phase 5: User Story 4 - Controlar el acceso según el rol (Priority: P1)

**Goal**: Autorización en backend por rol y ownership; identidad y roles solo desde claims verificados.

**Independent Test**: Con usuarios DONANTE, GESTOR y AUDITOR, invocar operaciones permitidas y
prohibidas directamente al backend y verificar 401/403/404 sin filtración.

### Tests for User Story 4

- [X] T050 [P] [US4] Unit test principal extraction ignores `donorSub`, roles and groups from body/query/headers in `backend/test/unit/authz/principal.test.ts`
- [X] T051 [P] [US4] Unit test RBAC/ownership policies deny DONANTE project management and GESTOR access to donor history in `backend/test/unit/authz/policies.test.ts`
- [X] T052 [P] [US4] Integration test DONANTE create/publish returns 403, GESTOR donor history returns 404 and body identity fields have no effect in `backend/test/integration/authz.roles.test.ts`
- [X] T053 [P] [US4] Contract test protected endpoints return uniform 401/403/404 error envelopes in `backend/test/contract/authz.errors.test.ts`

### Implementation for User Story 4

- [X] T054 [US4] Implement reusable authz middleware/handler wrappers combining principal extraction and RBAC/ownership guards in `backend/src/authz/middleware.ts` (each handler task T067, T074, T085 and T100 applies them to its own handlers)
- [X] T055 [US4] Complete uniform 403/404 response mapping without resource leakage in `backend/src/shared/http.ts`

**Checkpoint**: US4 funcional y verificable independientemente.

---

## Phase 6: User Story 5 - Exigir un segundo factor a roles privilegiados (Priority: P1)

**Goal**: GESTOR y AUDITOR usan MFA TOTP y no obtienen tokens sin completar el segundo factor.

**Independent Test**: Intentar iniciar sesión como GESTOR sin segundo factor y con TOTP; solo el
segundo caso obtiene tokens.

### Tests for User Story 5

- [X] T056 [P] [US5] Integration/manual test verifies GESTOR without second factor obtains no tokens in `backend/test/integration/auth.mfa-missing.test.ts`
- [X] T057 [P] [US5] Integration/manual test verifies GESTOR with TOTP obtains tokens and can access GESTOR operations in `backend/test/integration/auth.mfa-valid.test.ts`

### Implementation for User Story 5

- [X] T058 [US5] Configure Cognito TOTP MFA requirement for GESTOR/AUDITOR and disable SMS MFA in `infra/template.yaml`
- [X] T059 [US5] Implement frontend MFA challenge and incomplete-login error handling in `frontend/src/auth/AuthProvider.tsx`
- [X] T060 [US5] Document MFA setup, test evidence and no-SMS decision in `evidence/mfa.md`

**Checkpoint**: US5 funcional y verificable independientemente.

---

## Phase 7: User Story 9 - Crear y publicar proyectos (Priority: P1)

**Goal**: Un GESTOR crea proyectos BORRADOR y los publica; se registran eventos de auditoría.

**Independent Test**: Crear un proyecto válido como GESTOR, verificar BORRADOR y no público; publicarlo,
verificar PUBLICADO y visible; intentar como DONANTE y verificar 401/403; publicar dos veces y verificar 409.

### Tests for User Story 9

- [ ] T061 [P] [US9] Unit test project validation for `title` 1–120, `description` 1–2000, `goalAmountCents` entero > 0 and initial `BORRADOR` in `backend/test/unit/projects/create.test.ts`
- [ ] T062 [P] [US9] Contract test `POST /v1/projects` returns 201/400/401/403 and a BORRADOR project in `backend/test/contract/projects.create.test.ts`
- [ ] T063 [P] [US9] Contract test `PATCH /v1/projects/{projectId}/publish` returns 200/404/409 in `backend/test/contract/projects.publish.test.ts`
- [ ] T064 [P] [US9] Integration test GESTOR create/publish, DONANTE 403, already-published 409 and audit events in `backend/test/integration/projects.manage.test.ts`

### Implementation for User Story 9

- [ ] T066 [US9] Implement project create/publish repository with conditional writes and audit transaction in `backend/src/projects/repository.ts`
- [ ] T067 [US9] Implement `createProject` and `publishProject` handlers applying the authz middleware from T054 and wire Lambda/IAM permissions in `backend/src/projects/handlers/createProject.ts`, `backend/src/projects/handlers/publishProject.ts` and `infra/template.yaml`

**Checkpoint**: US9 funcional y verificable independientemente.

---

## Phase 8: User Story 6 - Registrar una intención de donación simulada (Priority: P1)

**Goal**: Crear donaciones PENDIENTE_SIMULACION con `amountCents` entero, `donorSub` desde el token e
idempotencia atómica por JSON completo canónico.

**Independent Test**: Con proyecto PUBLICADO y DONANTE autenticado, registrar una intención válida,
repetir la misma clave con la misma y distinta carga, y probar montos inválidos y clave ausente.

### Tests for User Story 6

- [ ] T068 [P] [US6] Unit test `amountCents` is an integer 100–100000 and rejects 0, 99, 100001, decimals, numeric strings and scientific notation in `backend/test/unit/donations/amount.test.ts` (scientific notation is rejected only when it arrives as a string, e.g. `"1e2"`; a numeric literal `1e2` equals the integer 100 after `JSON.parse` and is accepted, so assert both behaviours)
- [ ] T069 [P] [US6] Unit test canonical JSON hash is stable across key order/whitespace and changes with extra fields or different values in `backend/test/unit/donations/idempotency.test.ts`
- [ ] T070 [P] [US6] Unit test transaction outcome mapping for same key/same hash, same key/different hash and project not PUBLICADO in `backend/test/unit/donations/create.test.ts`
- [ ] T071 [P] [US6] Contract test `POST /v1/donations` returns 201/400/401/403/404/409 with `Idempotency-Key` in `backend/test/contract/donations.create.test.ts`
- [ ] T072 [P] [US6] Integration test idempotent replay, different-payload 409, unpublished-project 409 and no partial writes in `backend/test/integration/donations.create.test.ts`

### Implementation for User Story 6

- [ ] T073 [US6] Implement donation creation repository with one `TransactWriteItems` for `Idempotency` (`attribute_not_exists(pk)`), `Donations`, `Projects` `ConditionCheck` `status = PUBLICADO` and `AuditEvents` in `backend/src/donations/repository.ts`
- [ ] T074 [US6] Implement `createDonation` handler applying the authz middleware from T054 and deriving `donorSub` from authz; read the project with `GetItem` before the transaction and return 404 if it does not exist, then map transaction cancellations to 409 (idempotency conflict or non-PUBLICADO project) and validation failures to 400 in `backend/src/donations/handlers/createDonation.ts`
- [ ] T075 [US6] Wire donation creation Lambda, route and least-privilege IAM permissions (including `Projects` `GetItem`) in `infra/template.yaml`
- [ ] T076 [US6] Implement DonationPage with React Hook Form + Zod, cents conversion, UUID `Idempotency-Key` and 201/400/409 states in `frontend/src/pages/DonationPage.tsx`
- [ ] T077 [US6] Frontend test DonationPage validation, UUID generation and error states in `frontend/test/DonationPage.test.tsx`

**Checkpoint**: US6 funcional y verificable independientemente con datos semilla.

---

## Phase 9: User Story 7 - Simular la confirmación de una donación (Priority: P1)

**Goal**: Simulación académica de confirmación/rechazo con transición única, incremento atómico del
agregado y aviso de no cobro.

**Independent Test**: Crear una donación pendiente propia, confirmarla y rechazarla, repetir y
concurrentar la transición, y verificar el acumulado y el aviso académico.

### Tests for User Story 7

- [ ] T078 [P] [US7] Unit test only PENDIENTE_SIMULACION transitions to CONFIRMADA_SIMULADA or RECHAZADA_SIMULADA; terminal states return conflict in `backend/test/unit/donations/simulate.test.ts`
- [ ] T079 [P] [US7] Unit test confirmed transition increments `confirmedAmountCents` once and rejected transition does not in `backend/test/unit/donations/aggregate.test.ts`
- [ ] T080 [P] [US7] Contract test `POST /v1/donations/{donationId}/simulate` returns 200/400/401/403/404/409 and exists only in the academic stage in `backend/test/contract/donations.simulate.test.ts`
- [ ] T081 [P] [US7] Integration test 10 concurrent confirmations produce exactly one increment in `backend/test/integration/donations.concurrent.test.ts`
- [ ] T082 [P] [US7] Integration test rejected donation produces zero increment and repeated transition returns 409 in `backend/test/integration/donations.rejected.test.ts`
- [ ] T083 [P] [US7] Frontend test SimulationPage shows the exact text «Simulación académica: no se ha realizado ningún cobro» and handles 409 in `frontend/test/SimulationPage.test.tsx`

### Implementation for User Story 7

- [ ] T084 [US7] Implement simulation transaction in `backend/src/donations/repository.ts`: update donation with condition `status = PENDIENTE_SIMULACION` and `donorSub = :sub`, `ADD confirmedAmountCents` only on confirmation, and audit event
- [ ] T085 [US7] Implement `simulateDonation` handler applying the authz middleware from T054; read the donation with `GetItem` before the transaction and return 404 if it does not exist or belongs to another `donorSub`, then map transaction cancellation (terminal state or race) to 409 in `backend/src/donations/handlers/simulateDonation.ts`
- [ ] T086 [US7] Wire simulation Lambda and academic-only route with least-privilege IAM (including `Donations` `GetItem`) in `infra/template.yaml`
- [ ] T087 [US7] Implement SimulationPage with confirm/reject actions and mandatory academic disclaimer in `frontend/src/pages/SimulationPage.tsx`

**Checkpoint**: US7 funcional y verificable independientemente.

---

## Phase 10: User Story 2 - Consultar el detalle de un proyecto (Priority: P2)

**Goal**: Detalle público de un proyecto publicado con identificador, descripción, objetivo, estado y
monto acumulado, sin datos personales.

**Independent Test**: Abrir el detalle de un proyecto publicado, de un borrador y de un identificador
inexistente; verificar 200/404 y ausencia de datos de donantes.

### Tests for User Story 2

- [ ] T088 [P] [US2] Unit test detail returns 404 for nonexistent or non-PUBLICADO projects and never exposes donor data in `backend/test/unit/projects/detail.test.ts`
- [ ] T089 [P] [US2] Contract test `GET /v1/projects/{projectId}` returns 200/404 in `backend/test/contract/projects.detail.test.ts`
- [ ] T090 [P] [US2] Integration test public detail for published, draft and nonexistent project in `backend/test/integration/projects.detail.test.ts`
- [ ] T091 [P] [US2] Frontend test ProjectDetailPage 200/404 and no donor identifiers in `frontend/test/ProjectDetailPage.test.tsx`

### Implementation for User Story 2

- [ ] T092 [US2] Implement `getProject` repository/handler with published-only visibility in `backend/src/projects/repository.ts` and `backend/src/projects/handlers/getProject.ts`
- [ ] T093 [US2] Wire detail route with read-only IAM permissions in `infra/template.yaml`
- [ ] T094 [US2] Implement ProjectDetailPage with aggregate display, loading/error/404 states and no donor data in `frontend/src/pages/ProjectDetailPage.tsx`

**Checkpoint**: US2 funcional y verificable independientemente.

---

## Phase 11: User Story 8 - Consultar el historial propio (Priority: P2)

**Goal**: Historial de donaciones propias con fecha, importe, proyecto y estado; acceso ajeno rechazado.

**Independent Test**: Consultar el historial con dos donantes distintos y verificar que cada uno ve
solo sus registros y que el acceso a un registro ajeno responde 404 sin datos.

### Tests for User Story 8

- [ ] T095 [P] [US8] Unit test history query filters by `donorSub` and maps date, amount, project and status in `backend/test/unit/donations/history.test.ts`
- [ ] T096 [P] [US8] Contract test `GET /v1/donations/me` and `GET /v1/donations/{donationId}` return 200/401/404 in `backend/test/contract/donations.history.test.ts`
- [ ] T097 [P] [US8] Integration test two donors only see their own history and cross-user access returns 404 in `backend/test/integration/donations.history.test.ts`
- [ ] T098 [P] [US8] Frontend test MyDonationsPage list, empty and error states in `frontend/test/MyDonationsPage.test.tsx`

### Implementation for User Story 8

- [ ] T099 [US8] Implement `listByDonor` and `getById` repository methods with ownership in `backend/src/donations/repository.ts`
- [ ] T100 [US8] Implement `listMyDonations` and `getDonation` handlers applying the authz middleware from T054 and wire routes/IAM in `backend/src/donations/handlers/listMyDonations.ts`, `backend/src/donations/handlers/getDonation.ts` and `infra/template.yaml`
- [ ] T101 [US8] Implement MyDonationsPage with history fields, empty state and no cross-user data in `frontend/src/pages/MyDonationsPage.tsx`

**Checkpoint**: US8 funcional y verificable independientemente.

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Validación end-to-end, seguridad, accesibilidad, rendimiento y documentación.

- [ ] T102 Run quickstart scenarios 1–20 and record results in `evidence/quickstart-validation.md`
- [ ] T103 Audit and fix accessibility at 375 px and WCAG 2.2 AA applicable criteria in `frontend/src/pages/` and `frontend/src/components/`; record in `evidence/accessibility.md`
- [ ] T104 Measure 50-project catalog/detail latency (95% ≤ 1.5 s excluding cold start) and record method/tool/results in `evidence/performance.md`
- [ ] T105 Review IAM least privilege and remove wildcards in `infra/template.yaml`; record in `evidence/iam-review.md`
- [ ] T106 Complete structured logging coverage (`requestId`, action, result, status, duration) across handlers in `backend/src/shared/logger.ts` and `backend/src/*/handlers/`
- [ ] T107 Write threat model and NIST SP 800-207 mapping in `docs/threat-model.md`
- [ ] T108 Generate `docs/api.yaml` from `contracts/openapi.yaml` and validate OpenAPI 3.1 in CI
- [ ] T109 Update README with deployment, demo, cleanup, limitations and no-real-payments warning in `README.md`
- [ ] T110 Complete the required AI usage declaration in `AI_USAGE.md`
- [ ] T111 Finalize CI to run lint, typecheck, unit/integration/contract tests, build, `npm audit`, dependency guard and OpenAPI validation in `.github/workflows/ci.yml`
- [ ] T112 Document and verify cleanup (`sam delete`, empty S3, delete User Pool, verify no resources) in `README.md` and `evidence/cleanup.md`
- [ ] T113 Create traceability matrix mapping CA-01.1–CA-09.2 and CA-11.1–CA-11.2 to tests/evidence in `evidence/traceability.md`
- [ ] T114 Run security tests T01–T14 and record evidence in `evidence/security-tests.md`
- [ ] T115 Define SPA hosting in `infra/template.yaml`: private S3 bucket, CloudFront distribution with OAC, security response headers, frontend build upload/deploy step and CORS allowed origins matching the CloudFront domain
- [ ] T116 Configure API Gateway throttling, CloudWatch Logs retention of 14 days for all Lambda/API log groups and CloudTrail in `infra/template.yaml`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias; puede iniciar de inmediato.
- **Foundational (Phase 2)**: depende de Setup; bloquea todas las historias.
- **User Stories (Phase 3–11)**: dependen de Foundational.
  - US1 puede comenzar primero con datos semilla.
  - US3, US4, US5, US9, US6 y US7 son P1 y deben completarse antes de US2/US8 para el MVP.
- **Polish (Phase 12)**: depende de todas las historias deseadas.

### User Story Dependencies

- **US1 (P1)**: depende de Foundational; usa datos semilla, no de otra historia.
- **US3 (P1)**: depende de Foundational; habilita identidad para US4, US5, US9, US6 y US8.
- **US4 (P1)**: depende de US3 y Foundational; habilita RBAC/ownership en US9, US6 y US7.
- **US5 (P1)**: depende de US3.
- **US9 (P1)**: depende de US3 y US4; provee proyectos PUBLICADO para el flujo real de US6.
- **US6 (P1)**: depende de US3, US9 y US4; puede probarse con semillas si US9 aún no está listo.
- **US7 (P1)**: depende de US6.
- **US2 (P2)**: depende de US1 y US9/semillas.
- **US8 (P2)**: depende de US6 y US3.

### Within Each User Story

- Tests primero y deben fallar antes de implementar.
- Modelos/esquemas antes de repositorios; repositorios antes de handlers; handlers antes de rutas SAM.
- Backend antes de la integración frontend.
- Completar y validar cada historia antes de avanzar a la siguiente prioridad.

---

## Parallel Execution Examples

### US1 — Catálogo

```bash
Task: "T034 Unit test catalog mapping in backend/test/unit/projects/list.test.ts"
Task: "T035 Unit test confirmed-sum exclusions in backend/test/unit/projects/stats.test.ts"
Task: "T036 Contract test GET /v1/projects in backend/test/contract/projects.list.test.ts"
Task: "T037 Contract test GET /v1/projects/{projectId}/stats in backend/test/contract/projects.stats.test.ts"
```

### US3 — Login

```bash
Task: "T044 Integration test token rejection in backend/test/integration/auth.tokens.test.ts"
Task: "T045 Frontend auth memory/logout test in frontend/test/auth.test.tsx"
```

### US4 — Roles

```bash
Task: "T050 Unit test principal extraction in backend/test/unit/authz/principal.test.ts"
Task: "T051 Unit test RBAC/ownership policies in backend/test/unit/authz/policies.test.ts"
Task: "T052 Integration test role enforcement in backend/test/integration/authz.roles.test.ts"
```

### US5 — MFA

```bash
Task: "T056 Test missing second factor in backend/test/integration/auth.mfa-missing.test.ts"
Task: "T057 Test valid TOTP login in backend/test/integration/auth.mfa-valid.test.ts"
```

### US9 — Project management

```bash
Task: "T061 Unit test project validation in backend/test/unit/projects/create.test.ts"
Task: "T062 Contract test POST /v1/projects in backend/test/contract/projects.create.test.ts"
Task: "T063 Contract test PATCH publish in backend/test/contract/projects.publish.test.ts"
```

### US6 — Donation creation

```bash
Task: "T068 Unit test amount validation in backend/test/unit/donations/amount.test.ts"
Task: "T069 Unit test canonical idempotency hash in backend/test/unit/donations/idempotency.test.ts"
Task: "T070 Unit test transaction mapping in backend/test/unit/donations/create.test.ts"
Task: "T071 Contract test POST /v1/donations in backend/test/contract/donations.create.test.ts"
```

### US7 — Simulation

```bash
Task: "T078 Unit test transitions in backend/test/unit/donations/simulate.test.ts"
Task: "T079 Unit test aggregate increments in backend/test/unit/donations/aggregate.test.ts"
Task: "T080 Contract test simulate endpoint in backend/test/contract/donations.simulate.test.ts"
```

### US2 — Detail

```bash
Task: "T088 Unit test detail visibility in backend/test/unit/projects/detail.test.ts"
Task: "T089 Contract test GET /v1/projects/{projectId} in backend/test/contract/projects.detail.test.ts"
```

### US8 — History

```bash
Task: "T095 Unit test history filtering in backend/test/unit/donations/history.test.ts"
Task: "T096 Contract test history endpoints in backend/test/contract/donations.history.test.ts"
```

---

## Implementation Strategy

### MVP First

1. Completar Phase 1 (Setup) y Phase 2 (Foundational).
2. Completar US1 con datos semilla: primera demo del catálogo público con indicadores.
3. Completar US3, US4 y US9: identidad, autorización y gestión mínima de proyectos.
4. Completar US6 y US7: donación idempotente y simulación atómica.
5. Completar US5: MFA para roles privilegiados.
6. Validar el MVP con quickstart scenarios 1–19 y T01–T14.

**Suggested MVP scope**: todas las historias P1 (US1, US3, US4, US5, US6, US7, US9). El primer
incremento demostrable es Setup + Foundational + US1 con semillas.

### Incremental Delivery

1. Setup + Foundational → base desplegable.
2. US1 → catálogo público demostrable.
3. US3 + US4 + US9 → identidad, roles y proyectos gestionables.
4. US6 + US7 → donaciones simuladas con idempotencia y concurrencia.
5. US5 → MFA privilegiado y cierre de seguridad.
6. US2 + US8 → detalle e historial (P2).
7. Polish → accesibilidad, rendimiento, contrato, evidencia y limpieza.

### Parallel Team Strategy

- Completar Setup + Foundational en conjunto.
- Dividir después: Frontend (US1/US2/US8 UI), Backend de proyectos (US9/US1), Backend de donaciones
  (US6/US7), Seguridad/identidad (US3/US4/US5), QA/evidencia (Polish).
- Las historias P1 pueden avanzar en paralelo una vez completadas sus dependencias; US2/US8 al final.

---

## CA Traceability

Los identificadores de criterios de aceptación se conservan literalmente y se cubren así:

| CA | Tareas de verificación/evidencia |
|---|---|
| CA-01.1 | T034, T036, T038, T043 |
| CA-01.2 | T034, T036, T038 |
| CA-01.3 | T036, T039 |
| CA-09.1 | T035, T037, T039, T043 |
| CA-09.2 | T036, T037, T039, T043 |
| CA-02.1 | T088, T089, T090, T091, T094 |
| CA-02.2 | T088, T089, T090, T094 |
| CA-03.1 | T046, T047 |
| CA-03.2 | T044 |
| CA-03.3 | T045, T047 |
| CA-03.4 | T044, T046, T049 |
| CA-04.1 | T051, T052, T054 |
| CA-04.2 | T051, T052, T054 |
| CA-04.3 | T050, T052, T053, T055 |
| CA-11.1 | T058 |
| CA-11.2 | T056, T058 |
| CA-05.1 | T068, T071, T073, T074 |
| CA-05.2 | T068, T071, T073, T074 |
| CA-05.3 | T050, T052, T074 |
| CA-05.4 | T069, T070, T072, T073, T074 |
| CA-05.5 | T013, T071, T076 |
| CA-06.1 | T078, T080, T084, T085 |
| CA-06.2 | T078, T080, T081, T084 |
| CA-06.3 | T079, T082, T084 |
| CA-06.4 | T083, T087 |
| CA-07.1 | T095, T096, T099, T100, T101 |
| CA-07.2 | T097, T099, T100, T101 |
| CA-08.1 | T061, T062, T064, T066, T067 |
| CA-08.2 | T063, T064, T066, T067 |
| CA-08.3 | T020, T064, T066 |

**Cobertura final**: T113 genera la matriz completa CA → prueba/evidencia; T114 registra la ejecución
de T01–T14.

## Notes

- [P] tasks = archivos distintos, sin dependencias incompletas.
- [Story] labels mapean cada tarea a su historia y a los CA correspondientes.
- Los tests deben escribirse primero y fallar antes de la implementación.
- Cada historia debe poder demostrarse de forma independiente.
- No introducir Bootstrap ni Next.js en ningún punto.
- Todos los importes permanecen en céntimos enteros hasta la presentación.
- No hay pagos reales ni datos de tarjeta en ningún escenario.
