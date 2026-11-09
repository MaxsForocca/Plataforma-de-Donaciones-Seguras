<!--
Sync Impact Report
- Version change: unversioned scaffold -> 1.0.0
- Modified principles: none (initial adoption); added I-V
- Added sections: Restricciones de stack y seguridad; Flujo de desarrollo y puertas de calidad
- Removed sections: none
- Follow-up TODOs: none
- Note: remove this report before committing the amended constitution.
-->

# Plataforma de Donaciones Seguras Constitution

## Core Principles

### I. Zero Trust Estricto (NON-NEGOTIABLE)

Ninguna solicitud es confiable por su origen de red: ni VPC, ni IP, ni localhost, ni CloudFront, ni un
mismo host. Cada solicitud protegida MUST autenticarse y autorizarse en el backend por sesión y por
recurso, conforme a NIST SP 800-207.

- El backend MUST validar la firma del JWT, el emisor, la expiración, `client_id`, `token_use=access`
  y los scopes declarados antes de ejecutar cualquier caso de uso.
- La identidad (`sub`) y los roles (`cognito:groups`) MUST derivarse exclusivamente de claims
  verificados del access token. El backend MUST rechazar o ignorar `donorSub`, `sub`, roles, grupos
  o cualquier claim enviado en el body, query string o cabeceras distintas de `Authorization`.
- La autorización MUST aplicarse en el servidor con RBAC y ownership sobre el recurso persistido. Un
  guard de UI solo aporta UX y nunca sustituye la decisión del backend.
- Los roles IAM de cada función Lambda MUST seguir privilegio mínimo; MUST asumirse brecha y
  registrarse evidencia de auditoría sin datos sensibles.

Rationale: AD-01 y AD-04 exigen identidad y permisos verificados en cada solicitud y un backend
autoritativo; confiar en la red o en el cliente permitiría elevación vertical y BOLA.

### II. Prohibición de Bootstrap y Next.js (NON-NEGOTIABLE)

Bootstrap y Next.js están absolutamente prohibidos en cualquier forma (paquete, CDN, copia vendida,
React-Bootstrap o SSR), en el frontend, el backend y las herramientas.

- La UI MUST construirse con React + Vite + Tailwind CSS; Radix UI y Lucide React son opcionales.
- El build MUST fallar si `bootstrap` o `next` aparecen en manifiestos, lockfile o imports, o si se
  introduce renderizado del lado del servidor.
- No se aceptan excepciones por conveniencia, velocidad de desarrollo o familiaridad del equipo.

Rationale: el stack verificado en §2 fija React + Vite + Tailwind y descarta Next.js/SSR; estas
dependencias introducen estilos y patrones ajenos al diseño y a la superficie de seguridad definida.

### III. Dinero exclusivamente en céntimos enteros (NON-NEGOTIABLE)

Todo valor monetario MUST representarse como entero de céntimos de PEN mediante `amountCents`, en
transporte, validación, persistencia, aritmética y agregados. Ningún valor monetario puede usar
`float`, `double`, `number` fraccionario, `parseFloat` ni redondeos binarios.

- `POST /v1/donations` MUST aceptar el body `{ projectId, amountCents }`; el backend MUST validar
  `amountCents` como entero entre 100 y 100000 (S/ 1.00 a S/ 1,000.00) y responder 400 en caso
  contrario.
- Metas, acumulados y estadísticas MUST almacenarse como enteros (por ejemplo
  `confirmedAmountCents`); el formato con decimales MUST aplicarse solo en presentación.
- El sistema MUST NOT solicitar ni almacenar números de tarjeta, CVV, cuentas bancarias, DNI ni
  datos de pago reales.

Rationale: AD-04 y §5 prohíben representar dinero con `float`; los enteros eliminan errores de
redondeo y manipulación de importes.

### IV. Idempotencia atómica con TransactWriteItems (NON-NEGOTIABLE)

La creación de donaciones MUST ser atómica e idempotente mediante un único `TransactWriteItems` de
DynamoDB que registre la clave de idempotencia y la donación bajo condiciones, sin escrituras
parciales.

- `POST /v1/donations` MUST exigir la cabecera `Idempotency-Key` (UUID); sin ella MUST responder 400.
- El registro de idempotencia MUST usar la PK `donorSub#createDonation#idempotencyKey`, guardar
  `payloadHash` (SHA-256 del body normalizado), `donationId`, `responseStatus` y TTL de 24 h, y
  crearse con condición `attribute_not_exists`.
- Repetir la clave con el mismo `payloadHash` MUST devolver la respuesta almacenada sin crear otra
  donación; con hash distinto MUST responder 409. Un `TransactionCanceledException` MUST responder
  409 sin efectos parciales.
- La confirmación simulada MUST actualizar la donación e incrementar el agregado del proyecto en un
  `TransactWriteItems` condicionado por `status = PENDIENTE_SIMULACION` y `donorSub = :sub`.
- MUST NOT implementarse la idempotencia con lectura seguida de escritura ni con operaciones no
  transaccionales; MUST existir una prueba de concurrencia que lo demuestre.

Rationale: AD-05 y §4-5 exigen reserva de clave y creación de donación en una sola transacción
condicionada para impedir doble conteo y carreras.

### V. Tokens de corta duración (NON-NEGOTIABLE)

El access token MUST tener una vigencia máxima de 15 minutos (mínimo de Cognito: 5 minutos) y el
refresh token MUST ser revocable.

- La SPA MUST usar Authorization Code + PKCE y mantener los tokens solo en memoria; MUST limpiarlos
  al cerrar sesión y revocar el refresh token.
- Las rutas protegidas MUST exigir un access token (`token_use=access`) y MUST rechazar ID tokens.
- La limitación de revocación del JWT authorizer MUST documentarse: un token revocado sigue válido
  hasta expirar, y la vida corta acota esa ventana.
- MUST NOT emitirse access tokens de larga duración ni persistirse tokens en `localStorage` o
  `sessionStorage`.

Rationale: AD-07 y §6.3 establecen vida corta como mitigación de la falta de consulta de
revocaciones por parte del JWT authorizer.

## Restricciones de stack y seguridad

El stack aprobado es: TypeScript; React 19 + React DOM; Vite; Tailwind CSS 4; opcionalmente Radix UI
y Lucide React; React Router; React Hook Form + Zod (esquemas reutilizados en backend); TanStack
Query; oidc-client-ts o AWS Amplify Auth; Node.js 24 en Lambda; API Gateway HTTP API con JWT
authorizer y throttling; Cognito con grupos y MFA TOTP para GESTOR y AUDITOR; DynamoDB on-demand;
S3 privado + CloudFront con OAC y cabeceras de seguridad; CloudWatch Logs y CloudTrail; AWS SAM;
Vitest + Testing Library; ESLint + Prettier; GitHub Actions.

- Las donaciones son simuladas: MUST NOT procesarse pagos reales ni integrarse un PSP en este
  alcance.
- La infraestructura MUST limitarse al AWS Free plan, una sola región, y roles IAM separados por
  función con acciones y tablas mínimas.
- El frontend MUST NOT contener secretos ni credenciales AWS; MUST NOT versionarse `.env`, tokens ni
  datos personales reales.
- Los errores de API MUST usar el formato `{ code, message, requestId }` sin detalles internos; los
  logs y `AuditEvents` MUST excluir datos sensibles.
- Las versiones exactas MUST fijarse en `package-lock.json`; ante incompatibilidades debe elegirse
  una combinación estable y justificarse en el README.

## Flujo de desarrollo y puertas de calidad

- Todo cambio MUST entrar por Pull Request revisado por un integrante distinto del autor; la rama
  `main` MUST estar protegida y el CI MUST pasar lint, typecheck, pruebas y `npm audit`.
- MUST existir pruebas negativas de seguridad que demuestren: 401 sin token, con token expirado,
  alterado, de otro app client o con ID token; 403 por rol insuficiente; rechazo o ignorancia de
  `donorSub` y roles enviados por el cliente; replay idempotente con misma respuesta y 409 con carga
  distinta; y ausencia de efectos parciales bajo concurrencia.
- MUST demostrarse que la UI no implementa autorización, invocando el API directamente con tokens de
  otros roles.
- MUST existir pruebas de límites de `amountCents` y de rechazo de valores no enteros o flotantes.
- El CI MUST fallar ante la presencia de Bootstrap o Next.js y ante dependencias vulnerables
  conocidas.
- Todo cambio generado por asistentes de IA MUST pasar por PR con revisión humana, sin compartir
  credenciales, tokens ni datos personales, y MUST declararse en `AI_USAGE.md`.

## Governance

Esta constitución prevalece sobre cualquier otra práctica, guía o preferencia del equipo. Toda
revisión de Pull Request MUST verificar el cumplimiento de los cinco principios; una violación
bloquea el merge y no puede resolverse con una omisión silenciosa.

- **Enmiendas:** se proponen mediante issue o PR con la justificación, el impacto y un plan de
  migración; requieren aprobación por consenso del equipo y revisión de al menos un integrante
  distinto del proponente.
- **Versionado:** semántico. MAJOR ante eliminación o redefinición incompatible de principios o
  governance; MINOR ante un principio o sección nueva o guía materialmente ampliada; PATCH ante
  aclaraciones, redacción o correcciones no semánticas.
- **Cumplimiento:** cada PR y cada revisión MUST incluir una verificación explícita de los
  principios aplicables; las excepciones solo son válidas si se aprueba una enmienda documentada.
- **Guía de desarrollo:** el README, `design.md`, `requirements.md` y `AI_USAGE.md` proveen la guía
  operativa subordinada a esta constitución.

**Version**: 1.0.0 | **Ratified**: 2026-11-09 | **Last Amended**: 2026-11-09
