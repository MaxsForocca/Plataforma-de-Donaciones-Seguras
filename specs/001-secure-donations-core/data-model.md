# Data Model: Plataforma de Donaciones Seguras — Núcleo

**Feature**: `001-secure-donations-core` | **Date**: 2026-11-09

## Overview

DynamoDB on-demand con cuatro tablas lógicas. Los nombres físicos se prefijan con el stage:
`${Stage}Projects`, `${Stage}Donations`, `${Stage}Idempotency`, `${Stage}AuditEvents`. Todos los
importes monetarios son enteros en céntimos de PEN (`N`), nunca `float`. Las tablas usan cifrado en
reposo administrado por AWS y no contienen datos de tarjeta, CVV, cuentas bancarias ni DNI.

## 1. Projects

**Purpose**: proyectos sociales, estado de publicación y agregado confirmado.

**Key schema**

| Elemento | Valor |
|---|---|
| Partition key (PK) | `projectId` (String) |
| Sort key (SK) | — (tabla solo-PK) |
| GSI | `status-createdAt`: PK `status` (String), SK `createdAt` (String) |
| Projection | `ALL` |
| Billing | On-demand |

**Attributes**

| Atributo | Tipo | Requerido | Reglas |
|---|---|---|---|
| `projectId` | String (UUID) | Sí | Único; generado al crear |
| `title` | String | Sí | 1–120 caracteres, sin HTML |
| `description` | String | Sí | 1–2000 caracteres, sin HTML |
| `goalAmountCents` | Number (entero) | Sí | > 0; céntimos PEN |
| `confirmedAmountCents` | Number (entero) | Sí | ≥ 0; solo suma confirmada |
| `currency` | String | Sí | Constante `PEN` |
| `status` | String | Sí | `BORRADOR` o `PUBLICADO` |
| `createdBySub` | String | Sí | `sub` del GESTOR autenticado; uso interno/auditoría |
| `createdAt` | String (ISO 8601) | Sí | Fecha de creación |
| `updatedAt` | String (ISO 8601) | Sí | Última transición o actualización |

**State transitions**

```text
BORRADOR --publicar (GESTOR)--> PUBLICADO
PUBLICADO --publicar--> 409 (transición inválida)
```

- Un `BORRADOR` no aparece en catálogo ni acepta donaciones.
- `confirmedAmountCents` solo cambia por una confirmación simulada válida.
- No se permite volver a BORRADOR ni eliminar proyectos en este alcance.

**Access patterns**

| Operación | Acceso | Notas |
|---|---|---|
| Catálogo público | Query GSI `status-createdAt` con `status = PUBLICADO`; `ScanIndexForward=false` | Solo proyectos publicados |
| Detalle público | GetItem por `projectId` | 404 si no existe o no es PUBLICADO |
| Estadísticas públicas | GetItem por `projectId` | Devuelve `goalAmountCents` y `confirmedAmountCents` |
| Crear BORRADOR | PutItem con `attribute_not_exists(projectId)` | Genera `projectId`, `createdBySub`, timestamps |
| Publicar | UpdateItem con condición `status = BORRADOR` | 404 si no existe; 409 si ya está PUBLICADO |
| Validar donación | ConditionCheck dentro de `TransactWriteItems` | Exige `status = PUBLICADO` |

## 2. Donations

**Purpose**: intenciones de donación simuladas y su estado terminal.

**Key schema**

| Elemento | Valor |
|---|---|
| Partition key (PK) | `donationId` (String) |
| Sort key (SK) | — (tabla solo-PK) |
| GSI | `donorSub-createdAt`: PK `donorSub` (String), SK `createdAt` (String) |
| Projection | `INCLUDE` con `projectId`, `amountCents`, `currency`, `status`, `updatedAt` |
| Billing | On-demand |

**Attributes**

| Atributo | Tipo | Requerido | Reglas |
|---|---|---|---|
| `donationId` | String (UUID) | Sí | Único; generado al crear |
| `projectId` | String (UUID) | Sí | Debe existir y estar PUBLICADO al crear |
| `donorSub` | String | Sí | Solo desde el token verificado; nunca desde el body |
| `amountCents` | Number (entero) | Sí | 100–100000; céntimos PEN |
| `currency` | String | Sí | Constante `PEN` |
| `status` | String | Sí | `PENDIENTE_SIMULACION`, `CONFIRMADA_SIMULADA` o `RECHAZADA_SIMULADA` |
| `createdAt` | String (ISO 8601) | Sí | Fecha de creación |
| `updatedAt` | String (ISO 8601) | Sí | Última transición |

**State transitions**

```text
PENDIENTE_SIMULACION --confirmar--> CONFIRMADA_SIMULADA
PENDIENTE_SIMULACION --rechazar--> RECHAZADA_SIMULADA
CONFIRMADA_SIMULADA --cualquier transición--> 409
RECHAZADA_SIMULADA --cualquier transición--> 409
```

- Solo la primera transición válida modifica `Project.confirmedAmountCents`.
- Una donación `RECHAZADA_SIMULADA` nunca incrementa agregados.
- Las repeticiones y carreras se resuelven con condición de estado y ownership.

**Access patterns**

| Operación | Acceso | Notas |
|---|---|---|
| Crear donación | PutItem en transacción | Ver §5 |
| Historial propio | Query GSI `donorSub-createdAt` por `donorSub` del token | Orden descendente por `createdAt` |
| Leer donación propia | GetItem por `donationId` + validar `donorSub` | Acceso ajeno → 404 |
| Simular | UpdateItem condicionado | Ver §5 |

## 3. Idempotency

**Purpose**: reservar la clave de una creación de donación y permitir repeticiones seguras.

**Key schema**

| Elemento | Valor |
|---|---|
| Partition key (PK) | `pk` (String) = `donorSub#createDonation#idempotencyKey` |
| Sort key (SK) | — (tabla solo-PK) |
| TTL | `expiresAt` (Number, epoch seconds) |
| Billing | On-demand |

**Attributes**

| Atributo | Tipo | Requerido | Reglas |
|---|---|---|---|
| `pk` | String | Sí | `donorSub#createDonation#idempotencyKey` |
| `donorSub` | String | Sí | Identidad autenticada |
| `operation` | String | Sí | Constante `createDonation` |
| `idempotencyKey` | String (UUID) | Sí | Cabecera `Idempotency-Key` |
| `payloadHash` | String (hex SHA-256) | Sí | Hash del JSON completo canónico |
| `donationId` | String (UUID) | Sí | Donación creada en la misma transacción |
| `responseStatus` | Number | Sí | Código HTTP original (201) |
| `createdAt` | String (ISO 8601) | Sí | Fecha de reserva |
| `expiresAt` | Number | Sí | `createdAt + 24 h` en epoch seconds |

**Rules**

- La clave se crea con `attribute_not_exists(pk)` en la misma transacción que la donación.
- Misma clave + mismo `payloadHash`: responder el resultado almacenado sin crear otra donación.
- Misma clave + `payloadHash` distinto: 409.
- La clave está aislada por `donorSub`; dos usuarios pueden usar el mismo UUID sin colisión.
- El TTL es de 24 h; después de expirar, una nueva clave puede crear una nueva donación.

## 4. AuditEvents

**Purpose**: eventos estructurados de acciones críticas y trazabilidad por tipo y fecha.

**Key schema**

| Elemento | Valor |
|---|---|
| Partition key (PK) | `eventType` (String) |
| Sort key (SK) | `sk` (String) = `timestamp#eventId` |
| Billing | On-demand |

> El atributo de ordenación se llama `sk` y su **valor** es la concatenación `timestamp#eventId`
> (p. ej. `2026-11-11T12:00:00.000Z#0f8fad5b-…`). Los atributos `timestamp` y `eventId` se conservan
> además por separado.

**Attributes**

| Atributo | Tipo | Requerido | Reglas |
|---|---|---|---|
| `eventType` | String | Sí | `PROJECT_CREATED`, `PROJECT_PUBLISHED`, `DONATION_CREATED`, `DONATION_CONFIRMED`, `DONATION_REJECTED`, `ACCESS_DENIED` |
| `timestamp` | String (ISO 8601) | Sí | Parte del SK |
| `eventId` | String (UUID) | Sí | Parte del SK |
| `requestId` | String | Sí | Correlación con API Gateway/CloudWatch |
| `actorRef` | String | Sí | Referencia seudonimizada del actor (no token) |
| `action` | String | Sí | Acción realizada |
| `resourceRef` | String | Sí | `projectId` o `donationId` |
| `outcome` | String | Sí | `SUCCESS` o `DENIED` |
| `metadata` | Map | No | Solo datos no sensibles y acotados |

**Rules**

- Nunca se almacenan tokens, claves de idempotencia completas, datos personales reales ni datos
  financieros.
- La escritura de eventos críticos se incluye en la misma transacción que la operación cuando esta
  modifica estado.
- `GET /v1/audit` (HU-10) queda diferido; la tabla y el módulo de escritura sí forman parte del MVP.

## 5. Transactions and Consistency

### Create donation

`TransactWriteItems` con cuatro acciones:

1. `Put` en `Idempotency` con condición `attribute_not_exists(pk)`.
2. `Put` en `Donations` con condición `attribute_not_exists(donationId)`.
3. `ConditionCheck` en `Projects` con `status = PUBLICADO`.
4. `Put` en `AuditEvents` con `eventType = DONATION_CREATED`.

Si `TransactionCanceledException`:

- Si la causa es la clave de idempotencia existente: leer el registro; mismo `payloadHash` → devolver
  el resultado almacenado; distinto → 409.
- Si la causa es el proyecto inexistente o no publicado: 404 o 409 según corresponda.
- Nunca hay escrituras parciales.

### Simulate donation

`TransactWriteItems` con:

1. `Update` en `Donations` con condición `donationId = :id`, `donorSub = :sub` y
   `status = PENDIENTE_SIMULACION`; actualiza `status` y `updatedAt`.
2. Si el resultado es `CONFIRMADA_SIMULADA`: `Update` en `Projects` con `ADD confirmedAmountCents
   :amount` y condición `attribute_exists(projectId)`.
3. `Put` en `AuditEvents` con `eventType = DONATION_CONFIRMED` o `DONATION_REJECTED`.

Si el resultado es `RECHAZADA_SIMULADA`, no se incluye la actualización del proyecto. Cualquier
condición fallida devuelve 409 sin efectos parciales.

### Project create/publish

- Crear: `Put` en `Projects` con `attribute_not_exists(projectId)` + `Put` en `AuditEvents`
  (`PROJECT_CREATED`) en una transacción.
- Publicar: `Update` en `Projects` con condición `status = BORRADOR` + `Put` en `AuditEvents`
  (`PROJECT_PUBLISHED`) en una transacción. Un proyecto inexistente devuelve 404; uno ya publicado,
  409.

### Read consistency

- Lecturas por clave primaria inmediatamente después de una escritura propia usan `ConsistentRead`.
- Las queries por GSI (`catálogo`, `historial`) aceptan consistencia eventual; la UI refresca tras
  mutaciones con invalidación de TanStack Query.

## 6. Validation Rules

| Campo / regla | Validación |
|---|---|
| `amountCents` | Entero; 100 ≤ valor ≤ 100000; rechazar decimales, strings numéricos y notación científica |
| `goalAmountCents` | Entero; > 0 |
| `confirmedAmountCents` | Entero; ≥ 0; solo lo modifica el backend |
| `currency` | Exactamente `PEN` |
| `projectId` / `donationId` | UUID válido |
| `Idempotency-Key` | UUID válido; obligatorio en `POST /v1/donations` |
| `donorSub` | Solo desde claims verificados; cualquier valor del cliente se ignora o rechaza |
| `status` de proyecto | Solo `BORRADOR` o `PUBLICADO` |
| `status` de donación | Solo los tres estados definidos |
| JSON de donación | Canonicalización completa; campos extra se incluyen en la huella de idempotencia |
| Errores | `{ code, message, requestId }`; sin detalles internos ni datos de otros usuarios |

## 7. Access Pattern Summary

| Necesidad | Tabla | Índice | Operación |
|---|---|---|---|
| Catálogo de publicados | Projects | `status-createdAt` | Query |
| Detalle de proyecto | Projects | PK | GetItem |
| Estadísticas públicas | Projects | PK | GetItem |
| Crear/publicar proyecto | Projects | PK | PutItem/UpdateItem |
| Crear donación | Donations | PK | PutItem en transacción |
| Historial propio | Donations | `donorSub-createdAt` | Query |
| Leer donación propia | Donations | PK | GetItem + ownership |
| Reservar idempotencia | Idempotency | PK | PutItem condicional |
| Registrar auditoría | AuditEvents | PK/SK | PutItem |
| Consultar auditoría (HU-10) | AuditEvents | PK/SK | Query por tipo y rango (diferido) |
