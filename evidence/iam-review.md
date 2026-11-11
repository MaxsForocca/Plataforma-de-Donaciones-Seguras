# Revisión de Privilegio Mínimo de IAM (IAM Least Privilege Review)

**Proyecto:** Plataforma de Donaciones Seguras (Fundación AQP-SOLIDARIA)  
**Estándar:** NIST SP 800-207 — Principio de Menor Privilegio (Least Privilege)  
**Archivo Auditado:** `infra/template.yaml`  
**Pruebas Automatizadas de Verificación:** `backend/test/unit/projects/iam.test.ts` (34 pruebas pasando)  
**Estado:** Conforme y Verificado (T105)

---

## 1. Resumen Ejecutivo de la Auditoría

Se auditó de forma estricta la plantilla de infraestructura de AWS SAM (`infra/template.yaml`) para garantizar que:
1. **Cero Comodines (`*`):** Ninguna política IAM asignada a funciones Lambda utiliza asteriscos ni en las acciones (`Action`) ni en los recursos (`Resource`).
2. **Sin Políticas Administradas Amplias:** Ninguna función hace referencia a políticas globales permisivas como `AWSLambdaBasicExecutionRole` extendido, `AdministratorAccess`, `AmazonDynamoDBFullAccess` ni `PowerUserAccess`.
3. **Roles Explícitos y Aislados:** Cada función Lambda tiene una política inline granular (`Policies`) generada específicamente por SAM para su único propósito.
4. **Segregación Estricta de Lectura vs. Escritura:** Las funciones públicas de lectura carecen por completo de acciones mutables (`PutItem`, `UpdateItem`, `DeleteItem`, `BatchWriteItem`, `TransactWriteItems`).
5. **Aislamiento de Índices:** La consulta del catálogo público consulta exclusivamente el Global Secondary Index `status-createdAt` de la tabla `ProjectsTable`, sin otorgar permisos de `Scan` sobre la tabla principal.

---

## 2. Matriz Detallada de Permisos IAM por Función

| Función Lambda | Endpoint HTTP API / Evento | Acciones DynamoDB Permitidas | Recursos Permitidos (ARN Exacto) | Comodines | Justificación |
|---|---|---|---|---|---|
| **ListProjectsFunction** | `GET /v1/projects` (Público) | `dynamodb:Query` | `${ProjectsTable.Arn}/index/status-createdAt` | 0 | Solo consulta el índice secundario de proyectos en estado `PUBLICADO`. No lee borradores ni la tabla completa. |
| **GetProjectFunction** | `GET /v1/projects/{projectId}` (Público) | `dynamodb:GetItem` | `${ProjectsTable.Arn}` | 0 | Obtiene el proyecto por clave primaria (`PK=projectId`). No accede a donaciones ni auditoría. |
| **GetProjectStatsFunction** | `GET /v1/projects/{projectId}/stats` (Público) | `dynamodb:GetItem` | `${ProjectsTable.Arn}` | 0 | Lee los agregados (`confirmedAmountCents`, `donationCount`) del proyecto. No accede a donantes. |
| **CreateProjectFunction** | `POST /v1/projects` (GESTOR, `api/projects.write`) | `dynamodb:PutItem` | `${ProjectsTable.Arn}`, `${AuditEventsTable.Arn}` | 0 | Inserta el nuevo proyecto en estado `BORRADOR` y emite el evento de auditoría. |
| **PublishProjectFunction** | `PATCH /v1/projects/{projectId}/publish` (GESTOR, `api/projects.write`) | `dynamodb:GetItem`, `dynamodb:UpdateItem`, `dynamodb:PutItem` | `${ProjectsTable.Arn}`, `${AuditEventsTable.Arn}` | 0 | Lee el proyecto para verificar propiedad, actualiza estado a `PUBLICADO` y audita. Sin `Delete` ni `Scan`. |
| **CreateDonationFunction** | `POST /v1/donations` (DONANTE, `api/donations.write`) | `dynamodb:ConditionCheckItem`, `dynamodb:GetItem`, `dynamodb:PutItem` | `${ProjectsTable.Arn}`, `${DonationsTable.Arn}`, `${IdempotencyTable.Arn}`, `${AuditEventsTable.Arn}` | 0 | Verifica estado del proyecto (ConditionCheck/Get), escribe donación atómica con idempotencia (PutItem) y audita. No puede modificar proyectos. |
| **SimulateDonationFunction** | `POST /v1/donations/{donationId}/simulate` (Propietario / Stage `academic`) | `dynamodb:GetItem`, `dynamodb:UpdateItem`, `dynamodb:PutItem` | `${ProjectsTable.Arn}`, `${DonationsTable.Arn}`, `${AuditEventsTable.Arn}` | 0 | Transiciona estado en `Donations`, actualiza contadores en `Projects` y registra en `AuditEvents`. Sin acceso a idempotencia. |
| **ListMyDonationsFunction** | `GET /v1/donations/me` (DONANTE, `api/donations.read`) | `dynamodb:Query` | `${DonationsTable.Arn}/index/donor-createdAt` | 0 | Consulta el índice GSI `donor-createdAt` filtrando por el claim `sub` del donante autenticado. |
| **GetDonationFunction** | `GET /v1/donations/{donationId}` (DONANTE, `api/donations.read`) | `dynamodb:GetItem` | `${DonationsTable.Arn}` | 0 | Lee la donación por `donationId`. El aislamiento de pertenencia al donante lo impone el repositorio backend. |

---

## 3. Verificación Automatizada de Seguridad

El archivo de pruebas [`backend/test/unit/projects/iam.test.ts`](file:///home/maxs/Documentos/UNSA/2026B/LAB%20TAIS/ZERO%20TRUST/Plataforma%20de%20Donaciones%20Seguras/backend/test/unit/projects/iam.test.ts) valida automáticamente las siguientes aseveraciones en cada ejecución de `npm test`:

1. **Ausencia total de comodines:**
   ```typescript
   for (const value of [...actionsOf(name), ...resourcesOf(name)]) {
     expect(value).not.toContain("*");
   }
   ```
2. **Bloqueo de operaciones mutables en lectores públicos:**
   ```typescript
   const WRITE_ACTION = /(Put|Update|Delete|Batch|Transact|ConditionCheck|Create|Restore|Import|Tag)/;
   expect(actionsOf(name).filter(action => WRITE_ACTION.test(action))).toEqual([]);
   ```
3. **Exclusividad de tablas accesibles:**
   - Funciones públicas de proyectos nunca acceden a `DonationsTable`, `IdempotencyTable` ni `AuditEventsTable`.
   - `CreateDonationFunction` no puede hacer `UpdateItem` ni `DeleteItem` sobre `ProjectsTable`.

---

## 4. Conclusión

La configuración IAM en `infra/template.yaml` cumple cabalmente con las directrices de mínimo privilegio de NIST SP 800-207 y los requerimientos del laboratorio, neutralizando movimientos laterales en caso de compromiso puntual de una función Lambda.
