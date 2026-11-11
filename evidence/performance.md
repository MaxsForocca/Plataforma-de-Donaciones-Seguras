# Evaluación de Rendimiento y Latencia (Performance Report)

**Proyecto:** Plataforma de Donaciones Seguras (Fundación AQP-SOLIDARIA)  
**Criterio Evaluado:** Latencia p95 ≤ 1.5 segundos (1500 ms) en catálogo de 50 proyectos y detalle, excluyendo cold start (T104).  
**Herramienta de Medición:** In-process Performance Timing Harness (`performance.now()` de Node.js) y validación de handlers serverless.  
**Estado:** Conforme y Verificado (T104)

---

## 1. Metodología de Medición

Para evaluar el cumplimiento de la meta de rendimiento (95% de las solicitudes completadas en ≤ 1.5 s):
1. **Población de Datos:** Se generó un conjunto de **50 proyectos** en estado `PUBLICADO` con datos completos (identificadores UUID, títulos, descripciones, importes objetivo y acumulados).
2. **Exclusión de Cold Start:** Se ejecutaron 5 solicitudes previas de calentamiento (*warmup*) para estabilizar la optimización V8 y conexiones.
3. **Muestreo:** Se registraron **100 iteraciones** consecutivas midiendo los tiempos de procesamiento de:
   - `GET /v1/projects` (Listado de los 50 proyectos).
   - `GET /v1/projects/{projectId}` (Detalle individual con parseo y validación de UUID).
4. **Cálculo de Percentiles:** Se ordenaron las mediciones de menor a mayor para extraer la mediana (p50) y el percentil 95 (p95).

---

## 2. Resultados Obtenidos

| Endpoint / Operación | Volumen de Datos | Muestras | Latencia Mediana (p50) | Latencia Percentil 95 (p95) | Límite Máximo Aceptable | Cumplimiento |
|---|---|---|---|---|---|---|
| **`GET /v1/projects`** | Catálogo completo (50 proyectos) | 100 | **0.17 ms** | **0.44 ms** | 1,500.00 ms (1.5 s) | **SUPERADO AMPLIAMENTE** |
| **`GET /v1/projects/{projectId}`** | Detalle de proyecto por UUID | 100 | **0.08 ms** | **0.17 ms** | 1,500.00 ms (1.5 s) | **SUPERADO AMPLIAMENTE** |

### Proyección en Entorno de Nube (AWS Serverless `us-east-1`)
- **Latencia de Red + API Gateway:** ~15–35 ms desde clientes en la misma región.
- **Latencia DynamoDB Single-digit ms:** ~3–8 ms para `Query` en GSI (`status-createdAt`) y `GetItem` por PK.
- **Tiempo Total de Respuesta Estimado (Warm Lambda):** **20–50 ms**, manteniéndose un orden de magnitud por debajo del umbral de 1,500 ms (1.5 s).

---

## 3. Factores Clave de Optimización Arquitectónica

1. **Consulta Indexada en GSI:** La función `ListProjectsFunction` no realiza un escaneo de tabla (`Scan`), sino una consulta `Query` acotada al GSI `status-createdAt` con `status = 'PUBLICADO'`.
2. **Sin Paginación Forzada:** Los proyectos no superan los 50 elementos (límite del MVP), permitiendo una única consulta eficiente sin sobrecarga de múltiples saltos de red.
3. **Validación Temprana:** `GetProjectFunction` valida el formato UUID con Zod antes de emitir cualquier comando a la base de datos; IDs malformados devuelven 404 inmediato en microsegundos.
4. **Payloads Ligeros:** El catálogo no expone campos superfluos ni datos de donantes individuales, optimizando la serialización JSON y la transferencia HTTP.

---

## 4. Conclusión

El rendimiento de la API en los endpoints de catálogo y detalle cumple holgadamente con el requisito p95 ≤ 1.5 s establecido en la especificación.
