# Evidencia: MFA TOTP para roles privilegiados (CA-11.1, CA-11.2)

## 1. Configuración (T058)

En `infra/template.yaml`, recurso `UserPool`:

| Propiedad                                                                | Valor                  | Efecto                                                                              |
| ------------------------------------------------------------------------ | ---------------------- | ----------------------------------------------------------------------------------- |
| `MfaConfiguration`                                                       | `ON`                   | El segundo factor es **obligatorio**: ningún usuario obtiene tokens sin completarlo |
| `EnabledMfas`                                                            | `[SOFTWARE_TOKEN_MFA]` | Único método permitido: aplicación autenticadora (TOTP)                             |
| `SmsConfiguration`, `SmsAuthenticationMessage`, `SmsVerificationMessage` | ausentes               | No existe canal SMS                                                                 |
| `AutoVerifiedAttributes` / `UsernameAttributes`                          | solo `email`           | Ningún atributo de teléfono interviene                                              |
| `AccountRecoverySetting`                                                 | solo `verified_email`  | La recuperación de cuenta no usa SMS                                                |
| `LambdaConfig`                                                           | ausente                | Ningún disparador puede saltarse el desafío                                         |
| `AdminCreateUserConfig.AllowAdminCreateUserOnly`                         | `true`                 | Nadie se registra solo sin pasar por el alta del administrador                      |

### Decisión: MFA para todo el User Pool

Cognito aplica la política de MFA **a nivel de User Pool, no por grupo**. Para garantizar que GESTOR y
AUDITOR no obtengan tokens sin segundo factor (CA-11.2) se exige TOTP a todos los usuarios, incluidos los
DONANTE. Con `OPTIONAL`, un GESTOR que no hubiera configurado el segundo factor iniciaría sesión sin él.
Alternativa descartada por complejidad: MFA por grupo mediante un disparador Lambda _pre-token_.

### Decisión: sin MFA por SMS (CA-11.1)

El SMS es vulnerable a la suplantación de SIM y a la interceptación, y exigiría un canal de pago. Solo se
habilita TOTP.

## 2. Alta de usuarios privilegiados (procedimiento manual)

Lo ejecuta una persona del equipo con **sus propias credenciales** de AWS (ningún asistente lo hace):

1. Crear el usuario en el User Pool (consola de Cognito) con un correo verificable y contraseña temporal.
2. Añadirlo al grupo `GESTOR` o `AUDITOR`.
3. En el primer inicio de sesión, el Hosted UI pide cambiar la contraseña y **asociar una aplicación
   autenticadora** (escanear el código QR). Sin ese paso no se emiten tokens.
4. Si el usuario pierde su dispositivo, un administrador restablece su MFA desde la consola.

## 3. Evidencia

### 3.1 Verificada automáticamente (sin AWS)

Archivos: `backend/test/integration/auth.mfa-missing.test.ts` y `auth.mfa-valid.test.ts`.

- `MfaConfiguration` es `ON` (no `OPTIONAL` ni `OFF`) y `EnabledMfas` es exactamente `[SOFTWARE_TOKEN_MFA]`.
- No existe ninguna propiedad ni mención de SMS o teléfono en los recursos de Cognito.
- El frontend no contiene ninguna referencia a MFA por SMS.
- Los grupos `GESTOR`, `AUDITOR` y `DONANTE` pertenecen al pool con MFA obligatorio.
- Dado un access token con los claims de un GESTOR, el backend permite crear y publicar proyectos y
  deniega (403) las operaciones de DONANTE y de AUDITOR.
- La SPA no inicia sesión si el callback llega con `error=access_denied` (segundo factor no completado):
  `frontend/test/auth.test.tsx`, sección «login incompleto». Usa la biblioteca OIDC real con un Cognito
  **simulado solo a nivel de `fetch`**.

### 3.2 Pendiente de despliegue (NO probado)

Requiere un User Pool real. Ver la lista completa en `evidence/auth-pending-deployment.md`.

| #   | Comprobación                                              | Resultado esperado                                                  |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| M1  | GESTOR inicia sesión y **no** completa el segundo factor  | No recibe tokens; el login queda sin completar                      |
| M2  | AUDITOR inicia sesión y **no** completa el segundo factor | No recibe tokens                                                    |
| M3  | Primer inicio de sesión de un usuario nuevo               | El Hosted UI exige asociar una aplicación autenticadora             |
| M4  | Código TOTP incorrecto o vencido                          | No se emiten tokens                                                 |
| M5  | Opciones de segundo factor mostradas                      | Solo aplicación autenticadora; **sin SMS**                          |
| M6  | GESTOR completa TOTP                                      | Recibe access, ID y refresh token; `POST /v1/projects` responde 201 |
| M7  | DONANTE                                                   | También debe completar TOTP (consecuencia del MFA a nivel de pool)  |

## 4. Limitaciones conocidas

- **El backend no puede verificar el segundo factor.** El access token de Cognito no incluye evidencia de
  MFA que el backend pueda comprobar; un claim `amr` no se exige ni se confía (probado). La garantía
  descansa por completo en la configuración del User Pool.
- **MFA para todos**: los DONANTE de demostración también necesitan una aplicación autenticadora.
- La parte observable en la SPA es solo el resultado: el desafío ocurre dentro del Hosted UI de Cognito.
