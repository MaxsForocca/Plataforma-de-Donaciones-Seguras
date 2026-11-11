# Modelo de amenazas — Plataforma de Donaciones Seguras

> Documento vivo. Esta versión contiene las secciones de identidad y sesión (T049). El modelo completo
> y el mapeo a NIST SP 800-207 se completan en T107.

## 1. Alcance y supuestos

- Proyecto académico con donaciones **simuladas**; sin pagos reales ni datos de tarjeta.
- Modelo Zero Trust: ninguna solicitud es confiable por su origen de red; cada solicitud protegida se
  autentica y autoriza en el backend, por sesión y por recurso.
- La identidad (`sub`) y los roles (`cognito:groups`) provienen únicamente de los claims verificados del
  access token; nunca de campos enviados por el cliente.

## 2. Tokens y sesión

| Elemento                                  | Decisión                                                                                          | Motivo                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Flujo de inicio de sesión                 | Authorization Code + PKCE (S256); el flujo implícito no está habilitado                           | La SPA es un cliente público: PKCE sustituye al secreto y evita exponer tokens en la URL         |
| Access token                              | Vigencia máxima de **15 minutos** (mínimo de Cognito: 5)                                          | Acota la ventana de exposición ante robo o revocación                                            |
| ID token                                  | 15 minutos; **no** es una credencial de API                                                       | Las rutas protegidas exigen `token_use=access` y scopes, por lo que un ID token se rechaza (401) |
| Refresh token                             | 1 día, revocable (`EnableTokenRevocation`)                                                        | Permite cerrar la sesión de verdad                                                               |
| Almacenamiento en la SPA                  | Solo en memoria; nunca `localStorage` ni `sessionStorage`                                         | Reduce el impacto de XSS y de otros scripts del origen                                           |
| Estado de PKCE (`state`, `code_verifier`) | `sessionStorage` durante la redirección                                                           | Debe sobrevivir al salto al Hosted UI; no contiene tokens y se elimina al completar el login     |
| Cierre de sesión                          | Se revoca el refresh token, se eliminan los tokens de memoria y se cierra la sesión del Hosted UI | Constitución, principio V                                                                        |

## 3. Limitación conocida: revocación del access token (CA-03.4)

**Qué ocurre.** El JWT authorizer de API Gateway valida la firma, el emisor, la expiración, la
audiencia y los scopes del access token, pero **no consulta si el token fue revocado**. Por tanto, un
access token revocado antes de su expiración **sigue siendo aceptado hasta que expira**; después de
expirar se rechaza con 401. El backend tampoco mantiene una lista de revocación: su decisión depende
solo de los claims y del reloj.

**Qué sí se revoca.** Al cerrar sesión (o al revocar el token en Cognito) se revoca el **refresh token**:
nadie puede obtener nuevos access tokens a partir de esa sesión.

**Mitigación.** La vida corta del access token acota la ventana de exposición: como máximo
**15 minutos** desde la emisión. No se introducen access tokens de larga duración ni se persisten en el
navegador.

**Riesgo residual aceptado.** Durante esos minutos, un access token robado y ya revocado todavía serviría.
Se acepta por el alcance académico; una lista de revocación consultada en cada solicitud (por ejemplo,
un authorizer Lambda propio) queda fuera del MVP.

### Cómo se verifica

- **Verificado en pruebas automáticas (sin AWS):** el backend acepta un token hasta su `exp` y lo rechaza
  desde ese instante, sin consultar ningún almacén (`backend/test/unit/authz/principal.test.ts` y
  `backend/test/integration/auth.tokens.test.ts`); la vigencia configurada es ≤ 15 minutos
  (`infra/template.yaml`, comprobada por `auth.tokens.test.ts`).
- **Pendiente de despliegue (no se simula):** la demostración extremo a extremo con un User Pool y una
  API Gateway reales —usar un access token después de cerrar sesión, comprobar que aún se acepta hasta
  expirar y que luego da 401— se ejecuta con el procedimiento de `evidence/auth-pending-deployment.md`.

## 4. Amenazas de identidad y su control

| Amenaza                                                                | Control                                                                                                                                               | Evidencia                                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Solicitud sin token, vencido, alterado, de otro cliente o con ID token | JWT authorizer (firma, emisor, expiración, audiencia, scopes) + defensa en profundidad en el backend (`token_use=access`, `client_id`, emisor, `exp`) | `auth.tokens.test.ts`; pendiente de despliegue para la parte de API Gateway |
| Elevación de privilegios declarando roles o `donorSub`                 | `buildPrincipal` solo lee `requestContext.authorizer.jwt`                                                                                             | `principal.test.ts`, `authz.roles.test.ts`                                  |
| Acceso a recursos de otro usuario (BOLA)                               | Propiedad contra el recurso persistido; respuesta 404 idéntica para ajeno e inexistente                                                               | `policies.test.ts`, `authz.roles.test.ts`                                   |
| Robo de credenciales privilegiadas                                     | MFA TOTP obligatorio en todo el User Pool (Cognito no permite MFA por grupo); sin SMS                                                                 | `auth.mfa-missing.test.ts`; `evidence/mfa.md`                               |
| Robo de tokens desde el navegador                                      | Tokens solo en memoria; PKCE; sin flujo implícito                                                                                                     | `frontend/test/auth.test.tsx`                                               |
| Inyección de un ID token de otro cliente en la SPA                     | Validación de `iss`, `aud`, `exp` y `token_use` del ID token al completar el login                                                                    | `frontend/test/auth.test.tsx`                                               |
