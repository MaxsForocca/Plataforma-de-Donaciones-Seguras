# Contracts: Plataforma de Donaciones Seguras API

`openapi.yaml` es la fuente canónica del contrato HTTP del MVP. Usa OpenAPI 3.1 con esquemas JSON
embebidos en `components.schemas`; durante la implementación se publicará una copia derivada en
`docs/api.yaml`.

## Scope

Incluye:

- Catálogo, detalle y estadísticas públicas de proyectos.
- Alta en BORRADOR y publicación por GESTOR.
- Creación idempotente de donaciones, simulación académica, historial propio y lectura individual.

Queda diferido:

- `GET /v1/audit` (HU-10).
- Autorización externalizada con Cedar/Verified Permissions (HU-12).

## Security mapping

| Operación | Scope | Grupo | Ownership |
|---|---|---|---|
| `GET /v1/projects` | Público | — | — |
| `GET /v1/projects/{projectId}` | Público | — | — |
| `GET /v1/projects/{projectId}/stats` | Público | — | — |
| `POST /v1/projects` | `api/projects.write` | GESTOR | — |
| `PATCH /v1/projects/{projectId}/publish` | `api/projects.write` | GESTOR | — |
| `POST /v1/donations` | `api/donations.write` | DONANTE | `donorSub` desde el token |
| `POST /v1/donations/{donationId}/simulate` | `api/donations.write` | DONANTE | `donation.donorSub = token.sub` |
| `GET /v1/donations/me` | `api/donations.read` | DONANTE | `donorSub` desde el token |
| `GET /v1/donations/{donationId}` | `api/donations.read` | DONANTE | `donation.donorSub = token.sub` |

El JWT authorizer de API Gateway valida firma, emisor, expiración, `client_id`, `token_use=access` y
scopes. El backend valida además el grupo y el ownership; la SPA no decide autorización.

## Contract rules

- `amountCents` es un entero entre 100 y 100000 (S/ 1.00 a S/ 1,000.00).
- `goalAmountCents` y `confirmedAmountCents` son enteros en céntimos de PEN.
- `DonationCreateRequest` permite propiedades adicionales para que la huella incluya el JSON completo
  canónico; las propiedades extra no se usan como identidad ni autorización.
- `Idempotency-Key` es obligatorio y UUID en `POST /v1/donations`.
- La publicación usa `PATCH /v1/projects/{projectId}/publish`, según `design.md` §4.
- Un acceso a una donación ajena responde 404 para no revelar existencia.
- Los errores usan `{ code, message, requestId }`.

## Validation

El contrato debe validarse en CI con un validador OpenAPI 3.1 y probarse con la colección Bruno/Postman
del repositorio. Las respuestas de error negativas (400/401/403/404/409) forman parte del contrato y de
las pruebas T01–T14.
