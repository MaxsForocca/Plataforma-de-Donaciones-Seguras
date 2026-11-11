# Plataforma de Donaciones Seguras

Plataforma web para publicar proyectos sociales y registrar **donaciones simuladas**, construida
con Spec-Driven Development (GitHub Spec Kit) sobre AWS Free plan y con controles Zero Trust
(NIST SP 800-207). **No procesa pagos reales ni datos de tarjeta.**

Curso: Tópicos Avanzados en Ingeniería de Software, Escuela Profesional de Ingeniería de Sistemas, UNSA.

## Documentos

- `requirements.md` y `design.md`: requisitos y diseño entregados por el curso.
- `.specify/memory/constitution.md`: principios del proyecto.
- `specs/001-secure-donations-core/`: especificación, plan, modelo de datos, contrato OpenAPI y tareas.

## Estructura

| Carpeta | Contenido |
|---|---|
| `frontend/` | SPA React 19 + Vite + Tailwind CSS 4 |
| `backend/` | API en AWS Lambda (Node.js 24) por módulos: projects, donations, authz, audit |
| `packages/shared/` | Esquemas Zod, tipos y sobre de error compartidos |
| `infra/` | Plantilla AWS SAM y `samconfig.toml` |
| `scripts/` | Guard de dependencias y datos semilla |
| `docs/`, `evidence/` | Documentación técnica y evidencias de pruebas y despliegue |

## Desarrollo local

Requisitos: Node.js 22.22 o superior (las Lambda usan `nodejs24.x`).

```bash
npm install
npm run lint
npm run typecheck
npm run check:deps   # falla si aparecen Bootstrap o Next.js
npm test
npm run build
```

Copia `.env.example` a `.env` y completa los valores. El archivo `.env` no se versiona.

## Despliegue

El despliegue usa AWS SAM en una sola región (`us-east-1`) y el stage `academic`:

```bash
sam build -t infra/template.yaml
sam deploy -t infra/template.yaml --config-file infra/samconfig.toml --config-env academic
```

El detalle del despliegue (Cognito, usuarios de prueba y variables del frontend) se completa al
terminar la Fase 2. Al finalizar las pruebas, eliminar la pila con `sam delete` para no consumir créditos.

## Limitaciones conocidas

- Un access token revocado sigue siendo válido hasta que expira; se mitiga con una vida de 15 minutos.
- No hay verificación de postura del dispositivo ni evaluación continua de riesgo (no disponibles en el Free plan).
- HTTP API no se integra con AWS WAF; se usa throttling del stage y cabeceras de seguridad en CloudFront.

## Uso de IA

El uso de asistentes de IA se declara en `AI_USAGE.md`. Ningún secreto ni credencial de AWS se
comparte con asistentes de IA.
