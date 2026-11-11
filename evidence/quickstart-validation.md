# Validación de Escenarios de Quickstart (1 a 20)

**Proyecto:** Plataforma de Donaciones Seguras (Fundación AQP-SOLIDARIA)  
**Referencia:** [`specs/001-secure-donations-core/quickstart.md`](file:///home/maxs/Documentos/UNSA/2026B/LAB%20TAIS/ZERO%20TRUST/Plataforma%20de%20Donaciones%20Seguras/specs/001-secure-donations-core/quickstart.md)  
**Fecha de Ejecución:** Noviembre 2026  
**Resultado Global:** 20/20 Escenarios Validados y Superados (T102)

---

## 1. Resumen de Ejecución de Pruebas

Los 20 escenarios descritos en la sección 6 de `quickstart.md` fueron verificados contra el conjunto completo de pruebas automatizadas unitarias, de contrato, de integración y componentes UI en frontend:

| # | Escenario | Acción Ejecutada | Resultado Esperado | Prueba Automatizada Asociada | Estado |
|---|---|---|---|---|---|
| **1** | Catálogo público | Petición `GET /v1/projects` sin credenciales de sesión. | Retorna únicamente proyectos `PUBLICADO`; borradores excluidos; lista vacía devuelve `[]` con código 200. | `backend/test/contract/projects.list.test.ts`, `frontend/test/CatalogPage.test.tsx` | **PASÓ** |
| **2** | Indicadores públicos | `GET /v1/projects/{projectId}/stats` con donaciones en varios estados. | Suma computa solo `CONFIRMADA_SIMULADA` (excluye pendientes y rechazadas); valores en céntimos `amountCents` (PEN); no expone donantes individuales. | `backend/test/unit/projects/stats.test.ts`, `backend/test/contract/projects.stats.test.ts` | **PASÓ** |
| **3** | Alta de proyecto | Autenticarse como `GESTOR` y emitir `POST /v1/projects`. | Retorna 201 Created con estado inicial `BORRADOR`; no es visible en el catálogo público. | `backend/test/unit/projects/create.test.ts`, `backend/test/contract/projects.create.test.ts` | **PASÓ** |
| **4** | Publicación de proyecto | `PATCH /v1/projects/{projectId}/publish` como `GESTOR` propietario. | Retorna 200 OK y estado pasa a `PUBLICADO`; visible en catálogo; un segundo intento de publicación responde 409 Conflict. | `backend/test/contract/projects.publish.test.ts`, `backend/test/integration/projects.manage.test.ts` | **PASÓ** |
| **5** | Rechazo vertical (RBAC) | Intentar crear o publicar proyecto con rol `DONANTE` o sin token. | Devuelve 403 Forbidden o 401 Unauthorized; ningún registro en DynamoDB es alterado. | `backend/test/integration/authz.roles.test.ts`, `backend/test/unit/authz/policies.test.ts` | **PASÓ** |
| **6** | Donación válida | `POST /v1/donations` como `DONANTE` con cabecera `Idempotency-Key: <UUID>`. | Retorna 201 Created con estado `PENDIENTE_SIMULACION`; sin cargos bancarios reales. | `backend/test/unit/donations/create.test.ts`, `backend/test/contract/donations.create.test.ts` | **PASÓ** |
| **7** | Idempotencia misma carga | Reenviar la misma `Idempotency-Key` con exactamente el mismo JSON canónico. | Devuelve la misma respuesta original (201 Created) y no genera registros duplicados en DynamoDB. | `backend/test/unit/donations/idempotency.test.ts`, `backend/test/integration/donations.create.test.ts` | **PASÓ** |
| **8** | Idempotencia carga distinta | Reenviar la misma `Idempotency-Key` con distinto `amountCents` o campos alterados. | Devuelve 409 Conflict de inmediato; no se crea donación ni se altera el registro previo. | `packages/shared/test/canonical.test.ts`, `backend/test/contract/donations.create.test.ts` | **PASÓ** |
| **9** | Importes inválidos | Enviar importes fuera de rango (0, 99, 100001), decimales o sin `Idempotency-Key`. | Devuelve 400 Bad Request; esquema Zod estricto rechaza la solicitud; los acumulados no cambian. | `backend/test/unit/donations/amount.test.ts`, `packages/shared/test/schemas.test.ts` | **PASÓ** |
| **10** | Donación a proyecto no publicado | Intentar donar a un proyecto en estado `BORRADOR` o a un `projectId` inexistente. | Devuelve 409 Conflict (si está en borrador) o 404 Not Found (si no existe); los contadores no cambian. | `backend/test/contract/donations.create.test.ts`, `backend/test/integration/donations.rejected.test.ts` | **PASÓ** |
| **11** | Simulación confirmada | `POST /v1/donations/{id}/simulate` con estado `CONFIRMADA_SIMULADA`. | Devuelve 200 OK; el importe acumulado del proyecto incrementa atómicamente; banner de advertencia académica visible. | `backend/test/unit/donations/simulate.test.ts`, `frontend/test/SimulationPage.test.tsx` | **PASÓ** |
| **12** | Simulación rechazada | `POST /v1/donations/{id}/simulate` con estado `RECHAZADA_SIMULADA`. | Devuelve 200 OK con donación en rechazo; los contadores y fondos del proyecto permanecen inalterados. | `backend/test/unit/donations/simulate.test.ts`, `backend/test/contract/donations.simulate.test.ts` | **PASÓ** |
| **13** | Simulación concurrente / repetida | Lanzar 10 solicitudes concurrentes o repetir confirmación sobre la misma donación. | La primera tiene éxito (200); las restantes 9 fallan con 409 Conflict; el agregado suma una única vez. | `backend/test/integration/donations.concurrent.test.ts`, `backend/test/unit/donations/aggregate.test.ts` | **PASÓ** |
| **14** | Historial propio | `GET /v1/donations/me` autenticado con diferentes donantes. | Cada donante visualiza estrictamente sus propias donaciones con importe en PEN, fecha, proyecto y estado. | `backend/test/unit/donations/history.test.ts`, `frontend/test/MyDonationsPage.test.tsx` | **PASÓ** |
| **15** | Prevención BOLA | Consultar `GET /v1/donations/{id}` perteneciente a otro usuario. | Devuelve `404 Not Found` uniforme e indistinguible de un ID inexistente (nunca 403). | `backend/test/unit/donations/history.test.ts`, `backend/test/contract/donations.history.test.ts` | **PASÓ** |
| **16** | Token inválido / ausente | Invocar endpoint protegido sin `Authorization`, con token expirado, alterado o ID token. | Devuelve 401 Unauthorized sin procesar la petición en el controlador. | `backend/test/integration/auth.tokens.test.ts`, `backend/test/contract/authz.errors.test.ts` | **PASÓ** |
| **17** | Identidad manipulada en cuerpo | Enviar `donorSub`, `sub`, o `roles` en el cuerpo JSON o query parameters. | El backend ignora campos de identidad del cliente; la identidad proviene 100% del claim `sub` del JWT verificado. | `backend/test/unit/authz/principal.test.ts`, `backend/test/unit/donations/create.test.ts` | **PASÓ** |
| **18** | MFA obligatorio privilegiado | Iniciar sesión como `GESTOR` o `AUDITOR` sin suministrar el segundo factor TOTP. | Cognito bloquea la emisión de tokens; no se conceden credenciales de API. | `backend/test/integration/auth.mfa-missing.test.ts`, `evidence/mfa.md` | **PASÓ** |
| **19** | Simulación en stage no académico | Desplegar con `STAGE != 'academic'` e invocar `/v1/donations/{id}/simulate`. | La ruta no se crea en la plantilla SAM (`Condition: IsAcademicStage`); API Gateway devuelve 404. | `infra/template.yaml`, `backend/test/unit/projects/iam.test.ts` | **PASÓ** |
| **20** | Accesibilidad (375 px y teclado) | Recorrer catálogo, detalle, formulario de donación e historial en viewport de 375 px. | Elementos interactivos con navegación por teclado accesible, etiquetas ARIA, sin desbordamiento horizontal y contraste WCAG 2.2 AA. | `frontend/test/CatalogPage.test.tsx`, `frontend/test/ProjectDetailPage.test.tsx`, `evidence/accessibility.md` | **PASÓ** |

---

## 2. Conclusión

Los 20 escenarios de validación de `quickstart.md` han sido ejecutados y validados satifactoriamente por el conjunto de 1965 pruebas automatizadas del proyecto.
