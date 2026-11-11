## Descripción del cambio
<!-- Resume brevemente qué historia de usuario o tarea (T001-T114) resuelve este PR -->

## Tareas asociadas
- [ ] Tarea Spec Kit: `T0xx` (ver `specs/001-secure-donations-core/tasks.md`)
- [ ] Historia de usuario: `USx` / Criterio de Aceptación: `CA-xx.x`

## Checklists Zero Trust & DevSecOps (NIST SP 800-207)
- [ ] **Sin Secretos:** No se incluyen credenciales de AWS, tokens, ni archivos `.env` en los commits.
- [ ] **Fuentes de Identidad Confiables:** Los roles (`cognito:groups`) y el usuario (`sub`) se extraen exclusivamente del access token verificado por el backend, nunca del body/query.
- [ ] **Manejo Financiero Seguro:** Los importes están en céntimos enteros (`amountCents`); no se manipulan ni solicitan datos de tarjeta/CVV/cuenta.
- [ ] **Idempotencia y Transiciones:** Si aplica, se implementó con `TransactWriteItems` y huella canónica SHA-256.
- [ ] **Sin Dependencias Prohibidas:** Cumple con la constitución (sin Bootstrap ni Next.js).
- [ ] **Pruebas:** Incluye pruebas unitarias/de contrato y pruebas negativas de rechazo (401/403/409).

## Declaración de Uso de Asistentes IA
- [ ] **Herramienta usada:** OpenCode / GitHub Spec Kit / Antigravity
- [ ] **Revisión humana:** El código generado fue revisado y probado localmente antes de abrir el PR.
- [ ] **Registro en AI_USAGE.md:** Se documentó la interacción y prompts utilizados.
