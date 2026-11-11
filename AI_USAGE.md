# Registro de Uso de Asistentes IA (AI_USAGE.md)

**Curso:** Tópicos Avanzados en Ingeniería de Software — EPIS, UNSA  
**Práctica:** 04 — Plataforma de Donaciones Seguras AQP-SOLIDARIA  
**Semestre:** 2026 B  

---

## 1. Declaración de Principios de Trabajo con IA
Conforme a la sección 10 de `design.md` y las políticas del curso, el equipo adopta los siguientes lineamientos para el uso de asistentes de código (OpenCode, GitHub Spec Kit, Gemini / Claude):

1. **Revisión Humana Obligatoria:** Todo cambio o código propuesto por la IA se integra mediante Pull Request y debe ser revisado y aprobado por un integrante distinto del autor.
2. **Protección Estricta de Secretos:** Nunca se comparten con la IA credenciales de AWS, tokens JWT activos, llaves privadas ni archivos `.env`.
3. **Despliegue Supervisado:** La IA no ejecuta despliegues directos a AWS sin supervisión y aprobación humana expresa.
4. **Validación de Seguridad:** Las políticas IAM, módulos de autorización (`authz`) e idempotencia cuentan con pruebas unitarias y negativas ejecutadas en el entorno local y en el CI.

---

## 2. Registro de Fases del Ciclo SDD (Spec-Driven Development)

| Fecha | Herramienta | Fase / Comando | Prompt Resumido | Artefacto Generado / Resultado |
|---|---|---|---|---|
| 2026-11-09 | Spec Kit + OpenCode | `/speckit.constitution` | Definir principios Zero Trust, restricciones de stack (sin Bootstrap/Next.js) y AWS Free plan. | `.specify/memory/constitution.md` v1.0.0 |
| 2026-11-09 | Spec Kit + OpenCode | `/speckit.specify` | Generar especificación formal para EP-01, EP-02 y EP-03 conservando CA-01.1 a CA-11.2. | `specs/001-secure-donations-core/spec.md` (Checklist 16/16) |
| 2026-11-09 | Spec Kit + OpenCode | `/speckit.clarify` | Aclaraciones sobre HU-08 mínima, semillas e idempotencia canónica. | Registro de 3 decisiones en `spec.md` |
| 2026-11-09 | Spec Kit + OpenCode | `/speckit.plan` | Plan técnico con TypeScript, Node 24, React 19, Tailwind, SAM y DynamoDB. | `plan.md`, `research.md`, `data-model.md`, `contracts/openapi.yaml` |
| 2026-11-09 | Spec Kit + OpenCode | `/speckit.tasks` | Generar desglose de tareas ordenado por historias con pruebas previas a implementación. | `tasks.md` (114 tareas T001–T114) |
| 2026-11-10 | Antigravity / OpenCode | Setup DevSecOps | Configuración de GitHub Actions CI, .gitignore, guards de dependencias y templates. | `.github/workflows/ci.yml`, `scripts/check-deps.mjs`, `.github/pull_request_template.md` |
