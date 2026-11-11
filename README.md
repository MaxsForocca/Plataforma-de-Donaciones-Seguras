# Plataforma de Donaciones Seguras AQP-SOLIDARIA

Proyecto académico de aplicación web cloud-native serverless con modelo de seguridad **Zero Trust (NIST SP 800-207)** para la gestión y simulación de donaciones de la fundación ficticia «Fundación AQP-SOLIDARIA».

**Asignatura:** Tópicos Avanzados en Ingeniería de Software — EPIS, UNSA (2026 B)  
**Metodología:** Spec-Driven Development (SDD) con **GitHub Spec Kit** y **OpenCode**  
**Cuenta Cloud:** AWS Free plan (`us-east-1`)  

---

## 👥 Equipo de Trabajo y Roles

| Integrante | Rol en el Proyecto | Responsabilidades Principales |
|---|---|---|
| **Valentina Milagros Chambilla Perca** | Líder técnico y DevOps / Identidad | Cuenta AWS, plantilla SAM, CI/CD, CloudFront, Cognito, MFA TOTP, módulo `authz`, modelo de amenazas y mapeo NIST |
| **Maxs Sebastian Joaquin Forocca Mamani** | Backend Developer | Módulos `projects`, `donations`, idempotencia atómica, persistencia en DynamoDB y contratos de API |
| **Andre Jimmy Hilacondo Begazo** | Frontend Developer | SPA en React 19 + Vite, flujo OIDC con PKCE en memoria, Tailwind CSS y accesibilidad (WCAG 2.2 AA) |
| **Enrique Lipa Toledo** | QA y Documentación | Suite de pruebas de seguridad (T01–T14), pruebas negativas BOLA/401/403, evidencias y `AI_USAGE.md` |

---

## 🛡️ Principios Zero Trust Implementados (NIST SP 800-207)

1. **Ninguna solicitud es confiable por red:** No hay perímetros confiables; toda solicitud entrante debe ser autenticada y autorizada individualmente por API Gateway y Lambda.
2. **Identidad verificada en el servidor:** El backend (`authz`) extrae el identificador `sub` y los grupos (`DONANTE`, `GESTOR`, `AUDITOR`) exclusivamente de los claims del access token verificado por API Gateway HTTP API. **Prohibido confiar en `donorSub` o roles enviados en el cuerpo de la petición**.
3. **MFA obligatorio para cuentas privilegiadas:** Los roles `GESTOR` y `AUDITOR` exigen autenticación multifactor TOTP con app autenticadora.
4. **Tokens de corta duración y en memoria:** Access token con vigencia ≤ 15 minutos; la SPA almacena tokens únicamente en memoria y revoca el refresh token al cerrar sesión.
5. **Idempotencia atómica:** Escritura transaccional en DynamoDB (`TransactWriteItems`) para registrar donaciones e intenciones sin duplicados ni condiciones de carrera.
6. **Manejo exclusivo en céntimos enteros:** Todo importe se maneja como entero `amountCents` en PEN (S/ 1.00 a S/ 1,000.00). **Sin pasarelas reales, sin tarjetas de crédito ni datos financieros reales.**
7. **Principio de Mínimo Privilegio (IAM):** Roles IAM dedicados por función Lambda sin comodines `*`.

---

## 📁 Estructura del Proyecto

```text
├── .github/
│   ├── workflows/ci.yml         # Pipeline DevSecOps (Lint, Typecheck, Tests, npm audit)
│   └── pull_request_template.md # Plantilla de PR con verificación Zero Trust
├── .specify/                    # Configuración y memoria de GitHub Spec Kit
│   └── memory/constitution.md   # Constitución inmutable del proyecto
├── specs/001-secure-donations-core/
│   ├── spec.md                  # Especificación funcional (HU-01 a HU-09, HU-11)
│   ├── plan.md                  # Plan técnico de implementación
│   ├── tasks.md                 # 114 tareas de desarrollo (T001–T114)
│   ├── data-model.md            # Modelo de datos DynamoDB (4 tablas)
│   └── contracts/openapi.yaml   # Contrato canónico de API (OpenAPI 3.1)
├── packages/shared/             # Esquemas Zod y tipos compartidos
├── backend/                     # Handlers Lambda en Node.js 24 y TypeScript
├── frontend/                    # SPA React 19 + Vite 8 + Tailwind CSS 4
├── infra/                       # Infraestructura como Código (AWS SAM template.yaml)
├── scripts/
│   └── check-deps.mjs           # Guardián contra dependencias prohibidas (Bootstrap/Next)
├── AI_USAGE.md                  # Declaración de uso de asistentes IA
├── requirements.md              # Requerimientos base del curso
└── design.md                    # Diseño técnico base
```

---

## 🚀 Comandos de Desarrollo

```bash
# Instalar dependencias del monorepo
npm install

# Verificar guardianes de dependencias de la Constitución
npm run check-deps

# Ejecutar linters y verificación de tipos
npm run lint
npm run typecheck

# Ejecutar suite de pruebas unitarias y negativas
npm test

# Compilar todos los workspaces
npm run build
```
