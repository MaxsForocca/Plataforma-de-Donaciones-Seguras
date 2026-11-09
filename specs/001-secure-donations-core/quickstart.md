# Quickstart: Plataforma de Donaciones Seguras — Núcleo

**Feature**: `001-secure-donations-core` | **Date**: 2026-11-09

Guía de validación end-to-end. No contiene la implementación completa; los detalles de contrato y
datos están en [contracts/openapi.yaml](./contracts/openapi.yaml) y [data-model.md](./data-model.md).

## Prerequisites

- Node.js 24 y npm.
- AWS SAM CLI y AWS CLI configurados con credenciales temporales de un usuario IAM con MFA.
- Una cuenta AWS Free plan, una sola región (`us-east-1`) y una alerta de AWS Budgets.
- Un User Pool de Cognito con grupos `DONANTE`, `GESTOR` y `AUDITOR`, app client con Authorization
  Code + PKCE, access token de 5–15 min y MFA TOTP para GESTOR/AUDITOR.
- Sin credenciales reales, datos personales reales ni números de tarjeta en el repositorio.

## 1. Install and verify the monorepo

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Esperado: lint, typecheck, pruebas y build en verde. El CI ejecuta además `npm audit` y falla si
aparecen `bootstrap` o `next` en manifiestos, lockfile o imports.

## 2. Validate infrastructure and contracts

```bash
sam validate --lint
npm run contract:validate
```

Esperado: plantilla SAM válida y `contracts/openapi.yaml` válido como OpenAPI 3.1.

## 3. Deploy the academic stage

```bash
sam build
sam deploy --guided \
  --parameter-overrides Stage=academic \
  --capabilities CAPABILITY_IAM
```

Variables de entorno mínimas de las funciones: `STAGE`, `PROJECTS_TABLE`, `DONATIONS_TABLE`,
`IDEMPOTENCY_TABLE`, `AUDIT_TABLE`, `COGNITO_ISSUER`, `COGNITO_CLIENT_ID`, `ALLOWED_ORIGINS`.

El stage `academic` es el único que expone `POST /v1/donations/{donationId}/simulate`; en otros stages
la ruta no debe existir.

## 4. Load seed data

```bash
npm run seed -- --stage academic
```

Esperado: al menos un proyecto PUBLICADO, uno BORRADOR y donaciones de prueba en los tres estados
(PENDIENTE_SIMULACION, CONFIRMADA_SIMULADA, RECHAZADA_SIMULADA) con identidades ficticias.

## 5. Run the frontend

```bash
npm run dev:frontend
```

Configurar `VITE_API_BASE_URL` y los datos públicos del app client/OIDC. No configurar secretos en la
SPA. Los tokens deben permanecer en memoria.

## 6. Validation scenarios

| # | Escenario | Acción | Resultado esperado |
|---|---|---|---|
| 1 | Catálogo público | Abrir la SPA como visitante | Solo proyectos PUBLICADO; borradores ausentes; estado vacío comprensible si no hay publicados |
| 2 | Indicadores públicos | Consultar catálogo/detalle de un proyecto con donaciones en varios estados | La suma incluye solo CONFIRMADA_SIMULADA, excluye pendientes/rechazadas y se muestra en PEN; no aparecen donantes ni registros individuales |
| 3 | Alta de proyecto | Autenticarse como GESTOR y crear un proyecto válido | 201 y estado BORRADOR; no visible en catálogo |
| 4 | Publicación | Publicar el proyecto como GESTOR | 200 y estado PUBLICADO; visible en catálogo; segunda publicación responde 409 |
| 5 | Rechazo vertical | Intentar crear/publicar como DONANTE o visitante | 403 o 401; ningún proyecto modificado |
| 6 | Donación válida | Como DONANTE, enviar `{ projectId, amountCents }` con `Idempotency-Key` UUID | 201 con estado PENDIENTE_SIMULACION; no hay cobro |
| 7 | Idempotencia misma carga | Repetir la misma clave con el mismo JSON canónico | Mismo resultado; una sola donación |
| 8 | Idempotencia carga distinta | Repetir la clave con otro `amountCents` o un campo extra | 409; no se crea otra donación |
| 9 | Importes inválidos | Enviar 0, 99, 100001, decimales o sin `Idempotency-Key` | 400; el acumulado no cambia |
| 10 | Proyecto no publicado/inexistente | Donar a un BORRADOR o a un id inexistente | 409 o 404; el acumulado no cambia |
| 11 | Simulación confirmada | Como propietario, simular CONFIRMADA_SIMULADA | 200; el acumulado sube una sola vez; aviso «Simulación académica: no se ha realizado ningún cobro» visible |
| 12 | Simulación rechazada | Simular RECHAZADA_SIMULADA | 200; el acumulado no cambia |
| 13 | Simulación repetida/concurrente | Repetir o lanzar 10 confirmaciones de la misma donación | 409 en repeticiones; un solo incremento del agregado |
| 14 | Historial propio | Consultar `/v1/donations/me` con dos donantes | Cada uno ve solo sus donaciones con fecha, importe, proyecto y estado |
| 15 | BOLA | Consultar una donación de otro usuario | 404 sin datos del registro ajeno |
| 16 | Token inválido | Invocar ruta protegida sin token, con token expirado/alterado, de otro cliente o con ID token | 401 |
| 17 | Identidad manipulada | Enviar `donorSub`, roles o grupos en el body/query | No se usan como identidad ni autorización; la donación pertenece al `sub` del token |
| 18 | MFA privilegiado | Iniciar sesión como GESTOR/AUDITOR sin segundo factor | No obtiene tokens |
| 19 | Stage no académico | Desplegar en otro stage y solicitar la simulación | La ruta no existe (404 de API Gateway) |
| 20 | Accesibilidad | Usar catálogo, detalle, donación y confirmación a 375 px y con teclado | Navegación usable, etiquetas, mensajes accesibles, foco visible y contraste conforme a WCAG 2.2 AA aplicable |

## 7. Contract and security checks

```bash
npm run test:contract
npm test -- --runInBand
```

La colección de contrato debe cubrir al menos: 200 de catálogo, 201 de creación de proyecto, 200/409
de publicación, 201 de donación, replay idempotente, 409 por carga distinta, 404 por BOLA, 401 por ID
token y 403 por rol insuficiente.

## 8. Performance check

Con 50 proyectos publicados y desde un cliente cercano a `us-east-1`, medir al menos 20 solicitudes a
`GET /v1/projects` y `GET /v1/projects/{projectId}` excluyendo cold start. Registrar método, herramienta
y condiciones. Criterio: al menos 95% ≤ 1.5 s.

## 9. Cleanup

```bash
sam delete --stack-name <stack-name>
```

Además: vaciar y eliminar el bucket S3 de la SPA, eliminar el User Pool si no se borró con la pila y
verificar en Tag Editor/Resource Explorer que no queden recursos. No dejar tokens, `.env` ni
credenciales en el repositorio.

## References

- [Specification](./spec.md)
- [Implementation plan](./plan.md)
- [Data model](./data-model.md)
- [OpenAPI contract](./contracts/openapi.yaml)
- [Research decisions](./research.md)
