# Declaración de Uso de Asistentes de Inteligencia Artificial (AI_USAGE)

**Proyecto:** Plataforma de Donaciones Seguras (Fundación AQP-SOLIDARIA)  
**Asignatura:** Tópicos Avanzados en Ingeniería de Software (TAIS) — UNSA, 2026B  
**Equipo:** Subgrupo LA.1  
- Chambilla, Valentina  
- Forocca Mamani, Maxs Sebastian Joaquin  
- Hilacondo Begazo, Andre Jimmy  
- Lipa Toledo, Enrique  
**Docente:** M.Sc. Ing. Robert E. Arisaca M.

---

## 1. Declaración Ética y Cumplimiento Normativo

En cumplimiento de las pautas académicas de la asignatura y de la sección 10 de `design.md`, el equipo declara el uso de herramientas de asistencia basada en Modelos de Lenguaje (LLMs) y agentes de codificación autónoma para acelerar el ciclo de desarrollo guiado por especificaciones (Spec-Driven Development — SDD).

### Reglas de Uso Responsable y Zero Trust
1. **Revisión Humana Permanente:** Todo código, contrato, esquema o plantilla de infraestructura generado por los asistentes de IA ha sido rigurosamente inspeccionado, comprendido, probado y validado por los integrantes del equipo antes de ser incorporado a la rama principal o presentado en pull requests.
2. **Confidencialidad y Sin Secretos:** No se han proporcionado a los asistentes credenciales de AWS, claves privadas, tokens JWT reales, cadenas de conexión productivas ni archivos `.env`.
3. **Sin Despliegues Autónomos:** Los asistentes de IA no ejecutan despliegues en infraestructura de nube sin supervisión explícita humana ni operan con permisos administrativos no acotados.
4. **Verificación de Controles Críticos:** Los mecanismos de seguridad (autenticación JWT, verificación de claims, políticas RBAC/ABAC, prevención de BOLA, idempotencia transaccional con huella SHA-256 y políticas de mínimo privilegio IAM) cuentan con pruebas unitarias, de contrato y de integración redactadas y ejecutadas bajo enfoque TDD (Test-Driven Development) y validación de mutaciones.
5. **Capacidad de Sustentación:** Cada integrante del equipo comprende la totalidad de la arquitectura, decisiones de diseño, algoritmos implementados y justificaciones técnicas, encontrándose plenamente capacitado para su defensa oral.

---

## 2. Herramientas y Agentes Empleados

| Herramienta / Agente | Versión / Entorno | Fase del Ciclo SDD en que se utilizó | Responsabilidad Principal |
|---|---|---|---|
| **OpenCode** | v1.3.3.dev0 | Fases 1 a 6 (Constitución a Tareas) | Inicialización de GitHub Spec Kit, generación de `constitution.md`, `spec.md`, `plan.md`, `tasks.md`. |
| **Claude Code** | v1.2.5 (CLI / VS Code) | Fases 1 a 9, T115 y T116 | Análisis de consistencia, implementación guiada por TDD de Fases 1 a 9, pruebas de mutación y plantillas SAM. |
| **Antigravity (Google DeepMind)** | Antigravity 2.0 (Gemini 2.5 Pro / Flash) | Fases 10, 11 y 12 (Detalle, Historial, Polish, Auditoría y Cierre) | Implementación de US2 y US8, matriz de trazabilidad, modelo de amenazas NIST SP 800-207, auditoría IAM y cierre de pruebas de seguridad. |

---

## 3. Registro Cronológico de Interacciones y Prompts

### Fase 1: Constitución y Especificación Inicial (OpenCode)
- **Prompt:**
  ```text
  /speckit.constitution Define los principios de la Plataforma de Donaciones Seguras a partir de requirements.md y design.md: Zero Trust estricto con el backend como única fuente de verdad (NIST SP 800-207), sin Bootstrap ni Next.js, dinero en céntimos enteros, idempotencia atómica en las donaciones, tokens de corta duración, uso exclusivo del AWS Free plan en una sola región y puertas de calidad con lint, pruebas y CI.
  ```
- **Resultado:** Creación de `.specify/memory/constitution.md` v1.0.0.

- **Prompt:**
  ```text
  /speckit.specify Toma como fuente requirements.md. Genera el documento de especificación formal de Spec Kit para las épicas EP-01 (Descubrimiento), EP-02 (Identidad y acceso) y EP-03 (Donaciones simuladas). Conserva estrictamente los identificadores de criterios de aceptación (CA-01.1 a CA-11.2) y el fuera de alcance (no pasarelas reales, no tarjetas).
  ```
- **Resultado:** Generación de `specs/001-secure-donations-core/spec.md` y lista de chequeo (16/16 criterios).

---

### Fase 2: Planificación, Tareas y Análisis (OpenCode y Claude Code)
- **Prompt:**
  ```text
  /speckit.plan Genera el plan técnico para la Plataforma de Donaciones Seguras. Stack: React + Vite + Tailwind en el frontend; Node.js 24 + TypeScript en Lambda; DynamoDB con una tabla por entidad; Cognito User Pool con grupos y PKCE; API Gateway HTTP API con JWT authorizer; AWS SAM para la infraestructura.
  ```
- **Resultado:** Creación de `plan.md`, `research.md`, `data-model.md`, `openapi.yaml` y `quickstart.md`.

- **Prompt:**
  ```text
  /speckit-analyze Analiza la coherencia entre constitution.md, spec.md, plan.md y tasks.md. Busca conflictos de seguridad, violaciones de principios, tareas faltantes o contradicciones en los contratos de API y en los modelos de datos.
  ```
- **Resultado:** Detección de 10 inconsistencias (incluyendo el conflicto de TransactionConflict e idempotencia normalizada), incorporadas a `tasks.md` (116 tareas ampliadas).

---

### Fases 3 a 9: Implementación Guiada por Pruebas (Claude Code)
- **Prompts Plantilla Utilizados:**
  ```text
  /speckit-implement Implementa la Fase N de tasks.md (nombre de la historia de usuario, T0XX a T0YY) y marca cada tarea con [X] al terminar. Escribe las pruebas antes del código e incluye casos negativos y extremos propios de esa fase (entradas inválidas, roles incorrectos, accesos a recursos de otro usuario, concurrencia, campos extra que el navegador intente imponer). Reutiliza los tests de authz e idempotencia que ya existen en lugar de duplicarlos. Al terminar, repite mutaciones temporales sobre los controles de seguridad de esta fase y restaura el código. Respeta la constitución. No despliegues ni uses credenciales de AWS.
  ```
- **Fases Cubiertas:**
  - Fase 1 (T001–T012): Setup del monorepo, tooling, scripts y esquemas base.
  - Fase 2 (T013–T033): Fundaciones de seguridad, logger estructurado, cliente DynamoDB, serialización canónica SHA-256.
  - Fase 3 (T034–T043): Catálogo público de proyectos (US1).
  - Fases 4 a 6 (T044–T060): Identidad Cognito, RBAC/ownership, middleware `withAuth` y MFA TOTP (US3, US4, US5).
  - Fases 7 y 8 (T061–T077): Gestión de proyectos por gestores (US9) y creación de donaciones idempotentes (US6).
  - Fase 9 y T115–T116 (T078–T087, T115, T116): Simulación atómica de cobro (US7), infraestructura CloudFront/S3 SPA y logs CloudWatch/CloudTrail.

---

### Fases 10 y 11: Detalle de Proyectos e Historial Propio (Antigravity)
- **Prompt Fase 10 (US2: T088–T094):**
  ```text
  Implementa la Fase 10 de tasks.md (US2 — Consultar detalle de un proyecto, T088 a T094) y marca cada tarea con [X] al terminar. Escribe las pruebas antes del código e incluye casos negativos y extremos: proyecto borrador devuelve 404, proyecto inexistente devuelve 404, proyecto publicado devuelve 200 con agregados correctos, sin exponer donantes ni registros individuales. Reutiliza los tests de authz e idempotencia ya existentes. Al terminar, repite mutaciones temporales sobre los controles de seguridad de esta fase y restaura el código. Respeta la constitución. No despliegues ni uses credenciales de AWS.
  ```
- **Prompt Fase 11 (US8: T095–T101):**
  ```text
  Implementa la Fase 11 de tasks.md (US8 — Consultar historial propio, T095 a T101) y marca cada tarea con [X] al terminar. Escribe las pruebas antes del código e incluye casos extremos propios: acceso cruzado entre donantes devuelve 404 (nunca 403), token ausente devuelve 401, lista vacía devuelve [] no 404, donación inexistente con ID válido devuelve 404. Aplica el middleware de authz de T054. Reutiliza helpers existentes. Al terminar, repite mutaciones temporales sobre controles de seguridad y restaura el código. Respeta la constitución.
  ```
- **Resultado:** 14 nuevas suites de pruebas (unitarias, contrato, integración y frontend), aislamiento estricto de donante por claim `sub`, handlers `listMyDonations` y `getDonation`, y componentes UI con React Router y React Query.

---

### Fase 12: Polish, Seguridad y Cierre Transversal (Antigravity)
- **Prompt Fase 12 (T102–T114):**
  ```text
  Implementa las tareas de cierre de la Fase 12 (T102 a T114): redacción del modelo de amenazas formal bajo NIST SP 800-207, matriz de trazabilidad de criterios de aceptación CA-01.1 a CA-11.2, verificación de 20 escenarios de quickstart, auditoría de privilegio mínimo de IAM, reporte de pruebas de seguridad T01–T14, validación OpenAPI 3.1 en CI y documentación de limpieza y límites.
  ```
- **Resultado:** Generación de `evidence/traceability.md`, `evidence/security-tests.md`, `evidence/iam-review.md`, `evidence/quickstart-validation.md`, `evidence/accessibility.md`, `evidence/performance.md`, `evidence/cleanup.md`, sincronización de `docs/api.yaml` y actualización de `README.md`.

---

## 4. Conclusiones sobre la Experiencia con IA

1. **Eficiencia en la Generación de Pruebas Rigurosas:** La asistencia mediante LLMs permitió formular más de 1900 pruebas automatizadas cubriendo ramas de error, límites numéricos y vectores de ataque (inyección de campos extra, tokens alterados, colisiones hash).
2. **Importancia del Enfoque SDD:** Mantener la especificación (`spec.md`) y la constitución (`constitution.md`) como fuentes normativas impidió que los asistentes introdujeran dependencias no deseadas (como Bootstrap o Next.js) o desviaran la lógica monetaria hacia números con punto flotante.
3. **Rol Indispensable de la Supervisión Humana:** La detección de detalles críticos —como la sincronización temporal fija en tests JWT (`FIXED_NOW_MS`), el manejo de semántica de respuesta BOLA (404 en lugar de 403) y la preservación de encabezados semánticos de accesibilidad— requirió intervención y criterio ingenieril humano.
