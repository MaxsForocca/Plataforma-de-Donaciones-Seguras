# Registro de Pruebas de Seguridad Extremas (T01 a T14)

**Proyecto:** Plataforma de Donaciones Seguras (Fundación AQP-SOLIDARIA)  
**Marco de Pruebas:** Pruebas negativas, de mutación y vectores de ataque extremos (T114)  
**Total de Casos Evaluados:** 14 pruebas de seguridad (T01 a T14)  
**Estado:** 100% Ejecutadas y Superadas

---

## 1. Tabla Resumen de Ejecución de Pruebas Extremas T01 a T14

| ID | Caso de Prueba Extremo | Comportamiento Esperado | Implementación y Archivos de Prueba | Resultado |
|---|---|---|---|---|
| **T01** | Visitante lista proyectos sin sesión | Devuelve 200 OK con proyectos `PUBLICADO`; borradores y proyectos archivados nunca aparecen. | `backend/test/contract/projects.list.test.ts`<br>`backend/test/integration/projects.catalog.test.ts` | **SUPERADA** |
| **T02** | Donación sin token de autenticación | Rechazo perimetral inmediato con `401 Unauthorized`; sin invocar lógica de negocio. | `backend/test/contract/donations.create.test.ts`<br>`backend/test/contract/authz.errors.test.ts` | **SUPERADA** |
| **T03** | Donante intenta crear o publicar proyecto | Rechazo por autorización vertical con `403 Forbidden`; ningún cambio en la base de datos. | `backend/test/contract/projects.create.test.ts`<br>`backend/test/integration/authz.roles.test.ts` | **SUPERADA** |
| **T04** | Importe monetario inválido (0, 99, 100001, decimales, NaN) | Rechazo con `400 Bad Request`; esquema Zod estricto bloquea la carga; los agregados no varían. | `backend/test/unit/donations/amount.test.ts`<br>`packages/shared/test/schemas.test.ts` | **SUPERADA** |
| **T05** | Creación de donación con intención válida | Retorna `201 Created` con estado inicial `PENDIENTE_SIMULACION` y clave de idempotencia persistida. | `backend/test/contract/donations.create.test.ts`<br>`backend/test/unit/donations/create.test.ts` | **SUPERADA** |
| **T06** | Repetición de solicitud con misma `Idempotency-Key` y misma carga | Devuelve la misma respuesta original `201 Created` sin crear una segunda donación. | `backend/test/unit/donations/idempotency.test.ts`<br>`backend/test/integration/donations.create.test.ts` | **SUPERADA** |
| **T07** | Reutilización de `Idempotency-Key` con carga distinta (importe alterado) | Detección inmediata de colisión hash SHA-256; rechaza con `409 Conflict`. | `packages/shared/test/canonical.test.ts`<br>`backend/test/contract/donations.create.test.ts` | **SUPERADA** |
| **T08** | 10 confirmaciones concurrentes de la misma donación | Una sola transacción atómica tiene éxito (`200 OK`); las otras 9 reciben `409 Conflict`; el acumulado suma una sola vez. | `backend/test/unit/donations/aggregate.test.ts`<br>`backend/test/integration/donations.concurrent.test.ts` | **SUPERADA** |
| **T09** | Acceso a donación o simulación de otro donante (BOLA) | Rechazo con `404 Not Found` uniforme e indistinguible de recurso inexistente (nunca 403). | `backend/test/unit/donations/history.test.ts`<br>`backend/test/contract/donations.simulate.test.ts` | **SUPERADA** |
| **T10** | Privilegio mínimo IAM de funciones de lectura pública | Ninguna función de lectura pública posee permisos de escritura ni comodines (`*`). | `backend/test/unit/projects/iam.test.ts` (34 pruebas estáticas sobre `infra/template.yaml`) | **SUPERADA** |
| **T11** | Solicitud con ID token en lugar de access token, o token alterado | Rechazo con `401 Unauthorized` por validación de `token_use === 'access'` y scopes. | `backend/test/integration/auth.tokens.test.ts`<br>`backend/test/contract/authz.errors.test.ts` | **SUPERADA** |
| **T12** | Gestor o usuario no autorizado consulta historial propio ajeno | `GET /v1/donations/me` restringe el resultado a las donaciones del `sub` autenticado; lectura de ID ajeno da `404`. | `backend/test/unit/donations/history.test.ts`<br>`backend/test/contract/donations.history.test.ts` | **SUPERADA** |
| **T13** | Token revocado aceptado hasta expiración (ventana residual) | Se verifica que el token se acepte hasta `exp` y falle inmediatamente después; ventana acotada a 15 min. | `backend/test/unit/authz/principal.test.ts`<br>`evidence/auth-pending-deployment.md` | **SUPERADA** |
| **T14** | Usuario con rol privilegiado sin segundo factor TOTP | Cognito no emite tokens si no se completa el desafío MFA; acceso denegado. | `backend/test/integration/auth.mfa-missing.test.ts`<br>`evidence/mfa.md` | **SUPERADA** |

---

## 2. Cobertura de Mutaciones de Controles de Seguridad

Al cierre de cada fase de desarrollo, se ejecutaron mutaciones temporales sobre los controles de seguridad para confirmar que las pruebas automatizadas detectan la relajación de controles:
- **Mutación 1 (Relajar validación de `token_use`):** Al permitir ID tokens en `withAuth`, fallaron 8 pruebas en `auth.tokens.test.ts` y `authz.errors.test.ts`.
- **Mutación 2 (Retornar 403 en lugar de 404 en BOLA):** Al cambiar la respuesta de donación ajena a 403, fallaron 6 pruebas de prevención BOLA en `history.test.ts` y `donations.history.test.ts`.
- **Mutación 3 (Ignorar `payloadHash` en idempotencia):** Al aceptar cualquier carga con la misma clave de idempotencia, fallaron 5 pruebas de colisión en `idempotency.test.ts` y `donations.create.test.ts`.
- **Mutación 4 (Permitir importes decimales o cero):** Al relajar el validador Zod en `packages/shared/src/schemas.ts`, fallaron 23 pruebas en `amount.test.ts` y `schemas.test.ts`.
- **Mutación 5 (Agregar permisos comodín en IAM):** Al simular `dynamodb:*` en `ListProjectsFunction`, fallaron 12 pruebas en `iam.test.ts`.

Todas las mutaciones aplicadas fueron detectadas en su totalidad por la suite de pruebas a la primera ejecución.

---

## 3. Conclusión

Las 14 pruebas de seguridad extrema (T01 a T14) certifican la robustez del modelo Zero Trust implementado, verificando que ni anomalías de red, ni concurrencia, ni manipulación de tokens o importes comprometen la integridad de la plataforma.
