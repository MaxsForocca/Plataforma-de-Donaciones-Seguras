# Feature Specification: Plataforma de Donaciones Seguras — Núcleo (EP-01, EP-02, EP-03 y alta mínima de proyectos)

**Feature Branch**: N/A (sin rama dedicada)

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "Toma como fuente requirements.md. Genera el documento de especificación formal de Spec Kit para las épicas EP-01 (Descubrimiento), EP-02 (Identidad y acceso) y EP-03 (Donaciones simuladas). Conserva estrictamente los identificadores de criterios de aceptación (CA-01.1 a CA-11.2) y el fuera de alcance (no pasarelas reales, no tarjetas)."

## Clarifications

### Session 2026-11-09

- Q: ¿Cómo se obtendrán los proyectos PUBLICADO y BORRADOR que necesita EP-01 si la gestión de proyectos (HU-08) queda fuera de esta especificación? → A: Incluir la funcionalidad backend mínima de HU-08 para que un GESTOR cree proyectos en BORRADOR y los publique; además, proveer datos semilla con proyectos PUBLICADO y BORRADOR para pruebas unitarias, negativas (403/404) y la demo del catálogo.
- Q: ¿Qué se considerará «la misma carga» al comparar una Idempotency-Key repetida? → A: El JSON completo canónico (claves ordenadas y sin espacios insignificantes); cualquier diferencia, incluidos campos extra, cuenta como carga distinta.
- Q: ¿HU-09 (indicadores agregados) pertenece al alcance público del catálogo o a un módulo administrativo? → A: Pertenece al alcance público del catálogo y del detalle: CA-09.1 y CA-09.2 se incluyen como indicadores agregados para visitantes, no como módulo administrativo.

## User Scenarios & Testing *(mandatory)*

Esta especificación cubre el núcleo académico de la plataforma: descubrimiento público de proyectos
con indicadores agregados, identidad y control de acceso, registro y confirmación simulada de
donaciones, y la alta mínima de proyectos necesaria para que el catálogo exista. Las historias se
priorizan por valor y riesgo; cada una es verificable de forma independiente con identidades y
proyectos de prueba.

### User Story 1 - Descubrir proyectos publicados (Priority: P1)

Un visitante, sin autenticarse, explora el catálogo de proyectos sociales publicados y conoce su
propósito, meta y avance confirmado mediante indicadores agregados que excluyen donaciones pendientes
y rechazadas, antes de decidir si desea donar.

**Why this priority**: Es la entrada pública al producto y habilita la conversión a donante; sin
catálogo ni indicadores agregados no existe descubrimiento ni confianza en el avance de la causa.

**Independent Test**: Con una base de proyectos publicados, borradores y donaciones en distintos
estados, abrir el catálogo como visitante y verificar que solo aparecen los publicados, que la suma
confirmada excluye pendientes y rechazadas, que no se exponen donantes ni registros individuales y que
un catálogo vacío muestra un estado comprensible.

**Acceptance Scenarios**:

1. **CA-01.1** — **Given** que existen proyectos en estado PUBLICADO, **When** un visitante abre el
   catálogo, **Then** se muestra el nombre, la finalidad, la meta en PEN y la suma confirmada
   simulada de cada proyecto.
2. **CA-01.2** — **Given** un proyecto en estado BORRADOR, **When** el visitante abre el catálogo,
   **Then** el proyecto no aparece en la lista pública.
3. **CA-01.3** — **Given** que no existe ningún proyecto publicado, **When** el visitante abre el
   catálogo, **Then** se presenta un estado vacío comprensible, sin errores ni mensajes técnicos.
4. **CA-09.1** — **Given** un proyecto con donaciones confirmadas, pendientes y rechazadas, **When**
   el visitante consulta el catálogo o el detalle, **Then** la suma mostrada incluye solo las
   donaciones confirmadas, excluye pendientes y rechazadas, y se presenta en formato PEN.
5. **CA-09.2** — **Given** la vista pública del catálogo o del detalle, **When** un visitante la
   consulta, **Then** no se exponen identificadores de donantes ni registros individuales.

---

### User Story 2 - Consultar el detalle de un proyecto (Priority: P2)

Un visitante abre la ficha de un proyecto publicado y revisa su identificador, descripción, objetivo,
estado y monto acumulado, sin ver datos personales de donantes.

**Why this priority**: Permite evaluar la causa y da contexto a la donación; complementa el catálogo
sin ser imprescindible para el flujo mínimo de donación.

**Independent Test**: Abrir el detalle de un proyecto publicado y de uno no publicado o inexistente,
verificando los datos visibles y la ausencia de datos personales.

**Acceptance Scenarios**:

1. **CA-02.1** — **Given** un proyecto publicado, **When** un visitante consulta su detalle, **Then**
   se muestran identificador, descripción, objetivo, estado y monto acumulado, sin datos personales
   de donantes.
2. **CA-02.2** — **Given** un identificador inexistente o un proyecto no publicado, **When** un
   visitante intenta consultar su detalle, **Then** recibe HTTP 404 sin revelar contenido del
   proyecto.

---

### User Story 3 - Iniciar y cerrar sesión (Priority: P1)

Un donante se autentica con una identidad verificable para que sus acciones protegidas tengan un
propietario y puedan ser autorizadas por el servidor.

**Why this priority**: Sin autenticación no hay identidad confiable ni control de acceso; es la base
de Zero Trust para las operaciones protegidas.

**Independent Test**: Completar el inicio de sesión con un usuario de prueba, acceder a una operación
protegida, cerrar sesión y verificar que los tokens dejan de estar disponibles y que el refresh token
queda revocado.

**Acceptance Scenarios**:

1. **CA-03.1** — **Given** un usuario que inicia sesión, **When** completa el flujo de autenticación,
   **Then** se usa Authorization Code + PKCE obligatorio y el flujo implícito no se acepta.
2. **CA-03.2** — **Given** una ruta protegida, **When** se invoca sin token, con token expirado,
   alterado, emitido para otro cliente o usando un ID token en lugar del access token, **Then** el
   backend responde HTTP 401.
3. **CA-03.3** — **Given** una sesión activa, **When** el usuario inicia sesión o cierra sesión,
   **Then** el access token tiene vigencia máxima de 15 minutos (mínimo operativo del proveedor: 5
   minutos), los tokens se eliminan de memoria al cerrar sesión y el refresh token se revoca.
4. **CA-03.4** — **Given** un access token revocado antes de su expiración, **When** se usa contra
   una ruta protegida, **Then** se documenta y demuestra que el validador de tokens lo acepta hasta
   expirar, que la ventana de exposición queda acotada por la vida corta y que tras expirar se
   rechaza.

---

### User Story 4 - Controlar el acceso según el rol (Priority: P1)

Un responsable de la fundación confía en que solo las personas autorizadas ejecutan operaciones
sensibles, y que ningún cliente puede elevar sus privilegios declarando roles o identidades.

**Why this priority**: Es un control de seguridad no negociable: protege la creación y publicación de
proyectos y el historial privado de los donantes.

**Independent Test**: Autenticarse con usuarios DONANTE, GESTOR y AUDITOR de prueba, invocar
operaciones permitidas y prohibidas directamente al backend y verificar los códigos de rechazo y la
ausencia de filtración.

**Acceptance Scenarios**:

1. **CA-04.1** — **Given** un usuario con rol DONANTE, **When** intenta crear, modificar o publicar
   un proyecto, **Then** el backend responde HTTP 403 y no se modifica ningún proyecto.
2. **CA-04.2** — **Given** un usuario con rol GESTOR, **When** intenta consultar el historial privado
   de un donante, **Then** el backend responde HTTP 403 o 404 sin filtrar información.
3. **CA-04.3** — **Given** cualquier solicitud protegida, **When** el backend determina la identidad
   y los roles, **Then** usa exclusivamente el `sub` y el claim de grupos verificados del token, y
   nunca campos de identidad o roles enviados por el cliente.

---

### User Story 5 - Exigir un segundo factor a roles privilegiados (Priority: P1)

Un responsable de seguridad exige MFA TOTP a gestores y auditores para reducir el impacto del robo
de credenciales privilegiadas.

**Why this priority**: Mitiga una de las amenazas de mayor impacto del modelo Zero Trust y es
requisito obligatorio del MVP.

**Independent Test**: Intentar iniciar sesión como GESTOR sin el segundo factor y con el segundo
factor, verificando que solo en el segundo caso se obtienen tokens.

**Acceptance Scenarios**:

1. **CA-11.1** — **Given** un usuario de los grupos GESTOR o AUDITOR, **When** se configura su
   autenticación, **Then** tiene MFA TOTP con aplicación autenticadora y no se usa MFA por SMS.
2. **CA-11.2** — **Given** un usuario GESTOR, **When** inicia sesión sin completar el segundo factor,
   **Then** no obtiene tokens y la sesión no se considera autenticada.

---

### User Story 6 - Registrar una intención de donación simulada (Priority: P1)

Un donante autenticado registra un monto destinado a un proyecto publicado y recibe un registro
pendiente de simulación, sin que se realice ningún cargo.

**Why this priority**: Es la acción central del producto y el caso de uso que ejercita las reglas de
autorización, validación de importes e idempotencia.

**Independent Test**: Con un donante autenticado y un proyecto publicado, registrar una intención
válida, repetirla con la misma y con distinta carga, y probar montos inválidos y claves ausentes.

**Acceptance Scenarios**:

1. **CA-05.1** — **Given** un proyecto PUBLICADO, un importe válido en PEN (mínimo S/ 1.00, máximo
   S/ 1,000.00, máximo dos decimales, enviado como `amountCents` entero entre 100 y 100000) y una
   cabecera `Idempotency-Key` con formato UUID, **When** el donante registra la intención, **Then**
   se crea un registro PENDIENTE_SIMULACION y se responde HTTP 201.
2. **CA-05.2** — **Given** un monto cero, negativo, no entero, fuera de los límites o una solicitud
   sin `Idempotency-Key`, **When** se intenta registrar la donación, **Then** se responde HTTP 400;
   si el proyecto no existe se responde HTTP 404 y si no está PUBLICADO se responde HTTP 409; en
   ningún caso se modifica el acumulado.
3. **CA-05.3** — **Given** una donación autenticada, **When** el backend asigna el donante, **Then**
   el `donorSub` se obtiene de la identidad autenticada y nunca del cuerpo de la solicitud.
4. **CA-05.4** — **Given** una `Idempotency-Key` ya usada, **When** se reenvía la misma clave con la
   misma carga, **Then** se devuelve el mismo resultado sin crear otra donación; si la clave se
   reutiliza con una carga distinta, **Then** se responde HTTP 409; el registro de la clave y la
   donación se escriben de forma atómica.
5. **CA-05.5** — **Given** cualquier flujo de donación, **When** se solicita información al donante,
   **Then** no se solicitan ni almacenan datos de tarjeta, CVV, cuenta bancaria, DNI ni datos de pago
   reales.

---

### User Story 7 - Simular la confirmación de una donación (Priority: P1)

Un donante comprueba el resultado de su contribución en un flujo académico de prueba, con la
posibilidad de confirmarla o rechazarla, sin que se cobre dinero.

**Why this priority**: Cierra el ciclo de la donación simulada y demuestra la integridad del
acumulado y las transiciones de estado.

**Independent Test**: Crear una donación pendiente propia, simular confirmación y rechazo, repetir y
concurrentar la transición, y verificar el efecto en el acumulado y el aviso académico.

**Acceptance Scenarios**:

1. **CA-06.1** — **Given** una donación propia en estado PENDIENTE_SIMULACION, **When** el donante
   usa la simulación, **Then** puede pasarla a CONFIRMADA_SIMULADA o RECHAZADA_SIMULADA; la ruta
   solo existe en el entorno académico y no está disponible en ningún otro entorno.
2. **CA-06.2** — **Given** una donación pendiente, **When** se ejecuta la primera transición válida,
   **Then** se modifica el monto confirmado una sola vez; solicitudes repetidas o concurrentes no
   alteran el total y una transición inválida responde HTTP 409.
3. **CA-06.3** — **Given** una donación rechazada, **When** se consultan las cifras agregadas,
   **Then** la donación no incrementa ningún total confirmado.
4. **CA-06.4** — **Given** la interfaz de simulación, **When** el donante la utiliza, **Then** se
   muestra el texto «Simulación académica: no se ha realizado ningún cobro».

---

### User Story 8 - Consultar el historial propio (Priority: P2)

Un donante revisa sus donaciones simuladas y verifica fecha, importe, proyecto y estado, sin poder
ver las donaciones de otras personas.

**Why this priority**: Aporta transparencia y confianza al donante; depende de que existan donaciones
previas y refuerza la protección contra acceso horizontal.

**Independent Test**: Consultar el historial con dos donantes distintos y verificar que cada uno ve
solo sus registros y que el acceso a un registro ajeno se rechaza sin filtrar datos.

**Acceptance Scenarios**:

1. **CA-07.1** — **Given** un donante autenticado con donaciones, **When** consulta su historial,
   **Then** se muestran solo los registros asociados a su `sub`, con fecha, importe, proyecto y
   estado.
2. **CA-07.2** — **Given** una donación de otro usuario, **When** el donante intenta consultarla,
   **Then** el backend responde HTTP 403 o 404 sin revelar datos del registro ajeno (prueba BOLA).

---

### User Story 9 - Crear y publicar proyectos (Priority: P1)

Un gestor autenticado registra un proyecto en BORRADOR y lo publica para que aparezca en el catálogo y
pueda recibir donaciones simuladas.

**Why this priority**: EP-01 necesita proyectos PUBLICADO para existir; esta funcionalidad backend
mínima de HU-08 desbloquea el catálogo, las pruebas negativas y la demo sin ampliar el alcance a un
panel administrativo completo.

**Independent Test**: Crear un proyecto válido como GESTOR y verificar que no es público mientras está
en BORRADOR; publicarlo y verificar que aparece en el catálogo y acepta donaciones; intentar las
mismas operaciones como DONANTE y comprobar el rechazo.

**Acceptance Scenarios**:

1. **CA-08.1** — **Given** un usuario con rol GESTOR, **When** crea un proyecto con título,
   descripción y objetivo PEN positivo, **Then** el proyecto queda en estado BORRADOR; solo GESTOR
   puede crear proyectos.
2. **CA-08.2** — **Given** un proyecto BORRADOR válido, **When** un GESTOR lo publica, **Then** el
   proyecto pasa a PUBLICADO y puede recibir donaciones; un BORRADOR no acepta donaciones y publicar
   un proyecto ya publicado responde HTTP 409.
3. **CA-08.3** — **Given** una creación o publicación de proyecto, **When** la operación termina,
   **Then** se registra un evento de auditoría con actor, fecha, acción y resultado.

---

### Edge Cases

- Dos solicitudes simultáneas con la misma `Idempotency-Key` y la misma carga: una crea la donación y
  la otra devuelve el mismo resultado, sin duplicados ni errores parciales.
- Dos solicitudes simultáneas con la misma clave y carga distinta: exactamente una puede crear la
  donación; la otra recibe HTTP 409.
- Valores límite de `amountCents`: 100 y 100000 se aceptan; 99, 100001, 0, negativos y valores no
  enteros se rechazan con HTTP 400.
- El proyecto deja de estar PUBLICADO entre la selección y el envío: la donación se rechaza con
  HTTP 409 y el acumulado no cambia.
- El token expira o es alterado durante el flujo: la operación se rechaza con HTTP 401 y no produce
  efectos.
- El cliente envía `donorSub`, roles, grupos o un importe manipulado: el backend no los usa como
  identidad, autorización ni verdad financiera.
- El cliente repite la clave agregando un campo extra o cambiando el orden de las claves: la huella
  canónica del JSON completo cambia, por lo que la repetición se trata como carga distinta y responde
  HTTP 409; el campo extra no altera la identidad ni la autorización.
- La donación ya está en un estado terminal: una nueva simulación se rechaza con HTTP 409 y no altera
  el total.
- Un usuario GESTOR o AUDITOR no completa el segundo factor: no obtiene tokens ni accede a funciones
  privilegiadas.
- No hay proyectos publicados o el donante no tiene historial: se muestra un estado vacío
  comprensible, sin errores técnicos.
- Se usa un ID token en lugar de un access token: se rechaza con HTTP 401.
- Un access token revocado se usa antes de expirar: se acepta por limitación documentada del
  validador; tras expirar se rechaza.

## Requirements *(mandatory)*

### Functional Requirements

**Descubrimiento (EP-01)**

- **FR-001**: El sistema MUST mostrar en el catálogo público únicamente proyectos PUBLICADO, con
  nombre, finalidad, meta en PEN y suma confirmada simulada. (CA-01.1, CA-01.2)
- **FR-002**: El sistema MUST presentar un estado vacío comprensible cuando no existan proyectos
  publicados, sin errores ni detalles técnicos. (CA-01.3)
- **FR-003**: El sistema MUST mostrar el detalle de un proyecto publicado con identificador,
  descripción, objetivo, estado y monto acumulado, sin datos personales de donantes. (CA-02.1)
- **FR-004**: El sistema MUST responder HTTP 404 a la consulta de un proyecto inexistente o no
  publicado, sin revelar su contenido. (CA-02.2)

**Indicadores agregados públicos (HU-09)**

- **FR-028**: La suma confirmada visible en el catálogo y en el detalle MUST incluir únicamente
  donaciones CONFIRMADA_SIMULADA y MUST excluir las PENDIENTE_SIMULACION y RECHAZADA_SIMULADA; los
  montos MUST mostrarse en formato PEN. (CA-09.1)
- **FR-029**: La vista pública del catálogo y del detalle MUST NOT exponer identificadores de
  donantes ni registros individuales de donaciones. (CA-09.2)

**Identidad y acceso (EP-02)**

- **FR-005**: El sistema MUST autenticar mediante Authorization Code + PKCE y MUST NOT aceptar el
  flujo implícito. (CA-03.1)
- **FR-006**: El backend MUST rechazar con HTTP 401 toda solicitud protegida sin token, con token
  expirado o alterado, con token de otro cliente o con un ID token usado como access token. (CA-03.2)
- **FR-007**: El access token MUST tener una vigencia máxima de 15 minutos y el cierre de sesión MUST
  eliminar los tokens de memoria y revocar el refresh token. (CA-03.3)
- **FR-008**: El sistema MUST documentar y demostrar la limitación de revocación del validador de
  tokens: un access token revocado se acepta hasta expirar y se rechaza después; la vida corta acota
  la exposición. (CA-03.4)
- **FR-009**: El backend MUST aplicar RBAC y ownership por recurso; un DONANTE MUST recibir HTTP 403
  al intentar crear, modificar o publicar proyectos, y un GESTOR MUST recibir HTTP 403 o 404 al
  intentar consultar el historial privado de un donante. (CA-04.1, CA-04.2)
- **FR-010**: El backend MUST derivar la identidad (`sub`) y los roles del token verificado y MUST
  NOT aceptar `donorSub`, roles, grupos o claims equivalentes desde el cuerpo, la query o cabeceras
  del cliente. (CA-04.3, CA-05.3)
- **FR-011**: Los roles GESTOR y AUDITOR MUST usar MFA TOTP con aplicación autenticadora, MUST NOT
  usar MFA por SMS y MUST NOT obtener tokens sin completar el segundo factor. (CA-11.1, CA-11.2)

**Donaciones simuladas (EP-03)**

- **FR-012**: El sistema MUST aceptar una intención de donación solo para un proyecto PUBLICADO, con
  `amountCents` entero entre 100 y 100000 y una cabecera `Idempotency-Key` con formato UUID; MUST
  crear el registro PENDIENTE_SIMULACION y responder HTTP 201. (CA-05.1)
- **FR-013**: El sistema MUST responder HTTP 400 ante monto cero, negativo, no entero, fuera de
  límites o falta de `Idempotency-Key`; HTTP 404 ante proyecto inexistente; HTTP 409 ante proyecto no
  publicado; MUST NOT modificar el acumulado en ningún rechazo. (CA-05.2)
- **FR-014**: El sistema MUST asignar el `donorSub` exclusivamente desde la identidad autenticada.
  (CA-05.3)
- **FR-015**: El sistema MUST garantizar idempotencia atómica: misma clave y misma carga canónica
  devuelven el mismo resultado sin duplicar la donación; misma clave con carga distinta responde HTTP
  409; el registro de la clave y la donación se escriben juntos o no se escriben. La carga se compara
  como JSON completo canónico (claves ordenadas y sin espacios insignificantes), por lo que cualquier
  diferencia, incluidos campos extra, cuenta como carga distinta. (CA-05.4)
- **FR-016**: El sistema MUST NOT solicitar ni almacenar datos de tarjeta, CVV, cuenta bancaria, DNI
  ni datos de pago reales. (CA-05.5)
- **FR-017**: La simulación MUST permitir que un donante pase una donación propia de
  PENDIENTE_SIMULACION a CONFIRMADA_SIMULADA o RECHAZADA_SIMULADA, y la ruta MUST existir únicamente
  en el entorno académico. (CA-06.1)
- **FR-018**: Solo la primera transición válida MUST modificar el monto confirmado; repeticiones,
  concurrencia y transiciones inválidas MUST responder HTTP 409 y MUST NOT alterar el total.
  (CA-06.2)
- **FR-019**: Una donación RECHAZADA_SIMULADA MUST NOT incrementar ningún agregado confirmado.
  (CA-06.3)
- **FR-020**: La interfaz de simulación MUST mostrar el texto «Simulación académica: no se ha
  realizado ningún cobro». (CA-06.4)
- **FR-021**: El historial MUST mostrar solo los registros del `sub` autenticado, con fecha, importe,
  proyecto y estado. (CA-07.1)
- **FR-022**: El acceso a una donación de otro usuario MUST responder HTTP 403 o 404 sin revelar
  datos del registro ajeno. (CA-07.2)
- **FR-023**: Todos los rechazos de seguridad MUST ser uniformes y MUST NOT revelar datos internos,
  de otros usuarios ni detalles de implementación.

**Alta mínima de proyectos (HU-08)**

- **FR-024**: Solo un GESTOR MUST poder crear un proyecto con título, descripción y objetivo PEN
  positivo; el proyecto MUST quedar en estado BORRADOR. Sin autenticación MUST responder HTTP 401 y
  sin rol GESTOR MUST responder HTTP 403. (CA-08.1)
- **FR-025**: Solo un GESTOR MUST poder publicar un proyecto válido en estado BORRADOR; un BORRADOR
  MUST NOT aceptar donaciones y publicar un proyecto ya publicado MUST responder HTTP 409. (CA-08.2)
- **FR-026**: Toda creación o publicación de proyecto MUST registrar un evento de auditoría con
  actor, fecha, acción y resultado. (CA-08.3)
- **FR-027**: El proyecto MUST incluir un mecanismo reproducible de datos semilla con al menos un
  proyecto PUBLICADO y uno BORRADOR, utilizable en pruebas unitarias, pruebas negativas y la demo del
  catálogo. (Clarificación 2026-11-09)

### Key Entities *(include if feature involves data)*

- **Proyecto**: causa social con identificador, título, descripción, objetivo en PEN, meta en
  céntimos enteros, monto confirmado en céntimos enteros, moneda PEN, estado (BORRADOR o PUBLICADO) y
  fechas de creación y actualización. Solo los PUBLICADO son visibles públicamente.
- **Donación**: intención académica con identificador, proyecto asociado, `donorSub`, `amountCents`
  entero, moneda PEN, estado (PENDIENTE_SIMULACION, CONFIRMADA_SIMULADA o RECHAZADA_SIMULADA) y
  fechas de creación y actualización. Pertenece a un único donante.
- **Identidad y sesión**: donante, gestor o auditor autenticado; se representan por un `sub` y un
  claim de grupos verificados, con sesión de acceso corta y refresh revocable. Los roles privilegiados
  requieren MFA TOTP.
- **Registro de idempotencia**: clave compuesta por `donorSub`, operación y `Idempotency-Key`;
  conserva la huella de la carga, la donación creada, el resultado devuelto y una expiración de 24
  horas. Garantiza que una intención repetida no cree otra donación.
- **No entidad de pago**: no existe almacenamiento de tarjetas, CVV, cuentas bancarias, DNI ni datos
  financieros reales.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las solicitudes protegidas sin token válido se rechazan con HTTP 401 y no
  producen cambios de estado.
- **SC-002**: El 100% de los intentos de imponer `donorSub`, roles o grupos desde el cliente se
  ignoran o rechazan, sin conceder privilegios ni alterar la identidad efectiva.
- **SC-003**: El 100% de las intenciones válidas con clave única crean exactamente una donación; el
  reenvío con la misma clave y carga devuelve el mismo resultado, y con carga distinta responde 409.
- **SC-004**: Ante 10 confirmaciones concurrentes de la misma donación, se observa exactamente un
  incremento del monto confirmado; una donación rechazada produce cero incrementos.
- **SC-005**: El 100% de los importes manipulados por el sistema usan céntimos enteros; no se
  observan valores flotantes ni se recopilan datos de tarjeta, CVV o cuenta bancaria.
- **SC-006**: El 100% de los accesos a donaciones ajenas se rechazan con HTTP 403 o 404 sin revelar
  ningún campo del registro.
- **SC-007**: El 100% de los intentos de GESTOR o AUDITOR por obtener tokens sin completar el segundo
  factor fallan.
- **SC-008**: Un visitante puede localizar un proyecto publicado y comprender su meta y avance en
  menos de 1 minuto; con cero proyectos publicados ve un estado vacío sin errores técnicos.
- **SC-009**: Con 50 proyectos, al menos el 95% de las consultas públicas de catálogo y detalle
  responden en 1.5 segundos o menos desde un cliente cercano a la región, excluyendo el arranque en
  frío; la medición se documenta.
- **SC-010**: El 100% de los criterios CA-01.1 a CA-09.2 y CA-11.1 a CA-11.2 está cubierto por al
  menos una prueba de aceptación o evidencia documentada.
- **SC-011**: El 100% de los criterios de accesibilidad aplicables del flujo (catálogo, detalle,
  donación y confirmación) funcionan a 375 px de ancho, con teclado, etiquetas, mensajes accesibles y
  foco visible conforme a WCAG 2.2 AA en lo aplicable.
- **SC-012**: El 100% de los entornos de prueba y demo puede cargar los datos semilla con al menos un
  proyecto PUBLICADO y uno BORRADOR, y ejecutar las pruebas negativas 403/404 sin crear datos
  manualmente.
- **SC-013**: Un GESTOR puede crear un proyecto en BORRADOR y publicarlo en menos de 2 minutos; el
  100% de los intentos de DONANTE o visitante por crear o publicar recibe HTTP 401 o 403.
- **SC-014**: El 100% de las sumas públicas de catálogo y detalle excluye donaciones pendientes y
  rechazadas, se muestra en formato PEN y no expone identificadores de donantes ni registros
  individuales.

## Assumptions

- Se usan únicamente identidades, proyectos y donaciones ficticias de prueba; no se procesan fondos
  reales ni se recauda dinero.
- La moneda es PEN y todos los importes se expresan como céntimos enteros mediante `amountCents`.
- El proveedor de identidad gestionado, el entorno académico y la infraestructura aprobada se
  definen en `design.md` y en la constitución del proyecto; esta especificación describe el
  comportamiento observable y las restricciones de seguridad.
- La gestión de proyectos (HU-08) se incluye únicamente como backend mínimo de alta en BORRADOR y
  publicación; no incluye edición avanzada ni un panel administrativo completo.
- Los indicadores agregados de HU-09 se incluyen como parte del catálogo y del detalle públicos:
  muestran solo donaciones confirmadas, en formato PEN, sin identificadores de donantes ni registros
  individuales. No se incluye un módulo administrativo de indicadores.
- El proyecto incluye datos semilla reproducibles con proyectos PUBLICADO y BORRADOR para pruebas
  unitarias, pruebas negativas (403/404) y la demo del catálogo.
- La comparación de idempotencia usa el JSON completo canónico; el orden de las claves y los espacios
  insignificantes no alteran la huella, pero cualquier campo extra o valor distinto sí la altera.
- Cada identidad de prueba tiene un único rol principal (DONANTE, GESTOR o AUDITOR); la combinación
  de múltiples roles simultáneos queda fuera del MVP.
- Para el volumen académico de hasta 50 proyectos, el catálogo y el historial muestran el conjunto de
  resultados sin paginación; una paginación posterior queda fuera de esta especificación.
- La auditoría consultable (HU-10) y la autorización externalizada (HU-12) son extensiones fuera de
  esta especificación.
- Los usuarios privilegiados disponen de una aplicación autenticadora TOTP; no se usa SMS.
- El cierre de sesión revoca el refresh token, aunque el access token pueda seguir siendo aceptado
  hasta su expiración por la limitación conocida del validador.
- Los estados vacíos y los mensajes de error se presentan en español, sin detalles técnicos.

## Out of Scope

- Pasarelas de pago reales, adquirentes, tokenización de tarjetas, webhooks de pago, conciliación
  financiera, antifraude, comprobantes tributarios y cualquier cobro real.
- Solicitud o almacenamiento de números de tarjeta, CVV, cuentas bancarias, DNI o datos financieros
  reales.
- Recaudación de fondos reales y cumplimiento legal, tributario o PCI DSS.
- Edición avanzada de proyectos y panel administrativo completo. El alta mínima en BORRADOR y la
  publicación de HU-08, así como los indicadores agregados públicos de HU-09, sí están incluidos.
- Extensión de auditoría consultable (HU-10) y extensión de autorización externalizada (HU-12).
- Verificación de postura del dispositivo, evaluación continua de riesgo, ZTNA, detección gestionada
  y WAF, por limitaciones del entorno académico.
- Paneles de administración, reembolsos y conciliación de pagos.

**Trazabilidad reservada**: los identificadores CA-10.1 a CA-10.2 y CA-12.1 a CA-12.2 pertenecen a
extensiones fuera de este alcance y no se renumeran ni se redefinen en esta especificación.
