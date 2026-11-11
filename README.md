# Plataforma de Donaciones Seguras

Proyecto académico (UNSA, TAIS, Lab04): aplicación web con SPA React y API serverless en AWS para
descubrir proyectos sociales, autenticar usuarios, autorizar por rol y registrar **donaciones
simuladas** con idempotencia atómica.

> **⚠️ No hay pagos reales.** Todas las donaciones son simuladas con fines académicos. El sistema no
> procesa cobros, no recauda fondos y no solicita ni almacena datos de tarjeta, CVV, cuentas bancarias
> ni DNI. Use únicamente identidades y datos ficticios.

## Documentación

- [`requirements.md`](requirements.md) y [`design.md`](design.md): requisitos y diseño de origen.
- [`.specify/memory/constitution.md`](.specify/memory/constitution.md): principios no negociables.
- [`specs/001-secure-donations-core/`](specs/001-secure-donations-core/): especificación, plan, modelo
  de datos, contrato OpenAPI, quickstart y tareas.

## Stack

TypeScript · React 19 + Vite + Tailwind CSS 4 · React Router · React Hook Form + Zod · TanStack Query ·
oidc-client-ts · Node.js 24 en AWS Lambda · API Gateway HTTP API + Cognito · DynamoDB · S3 + CloudFront
· AWS SAM · Vitest. **Bootstrap y Next.js están prohibidos** (`npm run check-deps` lo verifica).

### Decisión de versiones: TypeScript 6.0.x

El plan prevé TypeScript 7.0.x, pero `typescript-eslint` (8.72.2, última estable) declara el peer
`typescript >=4.8.4 <6.1.0` y necesita la API JS del compilador. Para mantener una combinación estable
(constitución, «Restricciones de stack y seguridad») se fija **TypeScript ~6.0.3**. Se reevaluará la
migración a 7.x cuando `typescript-eslint` la soporte. Las versiones exactas quedan en
`package-lock.json`.

## Estructura

```text
frontend/         SPA React (workspace)
backend/          API serverless, un handler por caso de uso (workspace)
packages/shared/  Esquemas Zod, tipos y sobre de error compartidos (workspace)
infra/            Plantilla AWS SAM y configuración de despliegue
scripts/          Datos semilla y guardia de dependencias
docs/             Modelo de amenazas y API derivada
evidence/         Evidencias de pruebas y revisiones
```

## Requisitos previos

- Node.js 24 y npm 11.
- Para desplegar: AWS SAM CLI y credenciales de **su propia** cuenta (no se incluyen en el repositorio).

## Puesta en marcha

```bash
npm ci                 # instala con las versiones fijadas en package-lock.json
cp .env.example .env   # complete solo valores de su stage de pruebas; nunca se versiona
npm run lint
npm run typecheck
npm test
npm run check-deps
npm run seed -- --dry-run   # valida el formato de las fixtures (no escribe en AWS)
```

## Despliegue

El despliegue lo realiza manualmente una persona del equipo con sus credenciales; ningún asistente ni
el CI despliega. La infraestructura aún se está construyendo (Fase 2 de `tasks.md`).

```bash
sam build --template infra/template.yaml
sam deploy --template-file infra/template.yaml --config-file infra/samconfig.toml --config-env academic
```

La ruta de simulación de donaciones existe **solo** en el stage `academic`; en otro stage no se crea.

## Limitaciones conocidas

- Solo donaciones simuladas; sin pasarelas de pago ni cumplimiento PCI DSS o tributario.
- Una sola región (`us-east-1`) y AWS Free plan; hasta 50 proyectos, sin paginación.
- El JWT authorizer no consulta revocaciones: un access token revocado sigue siendo válido hasta
  expirar (máx. 15 min). La vida corta acota la ventana; se documentará en `docs/threat-model.md`.
- MFA TOTP para GESTOR y AUDITOR (sin SMS); un único rol por identidad de prueba.
- La auditoría consultable (HU-10) y la autorización externalizada (HU-12) quedan fuera del alcance.

## Limpieza de recursos

El procedimiento completo de eliminación (`sam delete`, vaciar S3, eliminar el User Pool) se
documentará en T112.
