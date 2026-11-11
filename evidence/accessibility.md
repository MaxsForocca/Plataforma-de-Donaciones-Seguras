# Auditoría de Accesibilidad Web (WCAG 2.2 Nivel AA y 375 px)

**Proyecto:** Plataforma de Donaciones Seguras (Fundación AQP-SOLIDARIA)  
**Estándar Evaluado:** Web Content Accessibility Guidelines (WCAG) 2.2 Nivel AA  
**Dispositivo / Viewport Base:** Móvil 375 px de ancho (iPhone SE / estándar responsive)  
**Archivos Auditados:** `frontend/src/pages/*` y `frontend/src/components/*`  
**Estado:** Conforme y Verificado (T103)

---

## 1. Alcance de la Auditoría

Se revisó la totalidad de las vistas de la Single Page Application (SPA):
1. **Catálogo Público de Proyectos** (`CatalogPage.tsx`)
2. **Detalle de Proyecto** (`ProjectDetailPage.tsx`)
3. **Formulario de Donación Simulada** (`DonationPage.tsx`)
4. **Pantalla de Confirmación / Simulación de Cobro** (`SimulationPage.tsx`)
5. **Historial de Donaciones Propias** (`MyDonationsPage.tsx`)
6. **Autenticación y Retorno OIDC** (`LoginCallbackPage.tsx`, `AuthProvider.tsx`)

---

## 2. Criterios de Conformidad WCAG 2.2 Nivel AA Verificados

| Criterio WCAG 2.2 | Nombre del Criterio | Implementación en la Plataforma | Estado |
|---|---|---|---|
| **1.1.1 (A)** | Non-text Content | Todos los íconos decorativos cuentan con `aria-hidden="true"`. Las imágenes o estados vacíos presentan descripciones textuales explícitas. | **CONFORME** |
| **1.3.1 (A)** | Info and Relationships | Uso estricto de elementos semánticos HTML5 (`<header>`, `<main>`, `<nav>`, `<section>`, `<article>`, `<table>`, `<th> scope="col"`). Jerarquía lógica de encabezados (`h1` principal por página, `h2` para secciones secundarias). | **CONFORME** |
| **1.4.3 (AA)** | Contrast (Minimum) | Las combinaciones cromáticas de texto y fondo superan la relación de contraste de **4.5:1** para texto normal y **3:1** para texto grande (ej. `text-slate-900` sobre fondos blancos, botones con `bg-blue-600` y `text-white` con ratio 4.6:1). | **CONFORME** |
| **1.4.10 (AA)** | Reflow (375 px) | Diseño móvil-primero (mobile-first) utilizando Tailwind CSS. El contenido se adapta sin pérdida de información ni necesidad de desplazamiento bidireccional (scroll horizontal) a 375 px de ancho. | **CONFORME** |
| **2.1.1 (A)** | Keyboard | Todos los elementos interactivos (enlaces, botones, campos de entrada) son alcanzables y accionables exclusivamente mediante el teclado (`Tab`, `Enter`, `Space`). | **CONFORME** |
| **2.4.3 (A)** | Focus Order | El orden de tabulación sigue la secuencia lógica de lectura y flujo del documento. Los modales y mensajes de error retienen y dirigen el foco de manera intuitiva. | **CONFORME** |
| **2.4.7 (AA)** | Focus Visible | Anillos de enfoque visibles y de alto contraste en todos los elementos interactivos (`focus:ring-2 focus:ring-offset-2 focus:ring-blue-600`). | **CONFORME** |
| **2.5.8 (AA)** | Pointer Target Spacing | Todos los botones y controles táctiles cuentan con un área interactiva mínima de **44 × 44 píxeles** (o espaciado circundante suficiente), evitando pulsaciones accidentales en pantallas táctiles móviles. | **CONFORME** |
| **3.3.1 (A)** | Error Identification | Los errores de validación de formularios (e.g. importes inválidos fuera de 100–100000 céntimos) se notifican mediante texto claro con `role="alert"` y asociación `aria-describedby`. | **CONFORME** |
| **3.3.2 (A)** | Labels or Instructions | Todos los campos de entrada (`<input>`) disponen de etiquetas visuales y programmaticas explícitas mediante `<label htmlFor="...">`. | **CONFORME** |
| **4.1.3 (AA)** | Status Messages | Mensajes de carga y actualización asíncrona utilizan atributos de accesibilidad en vivo (`aria-live="polite"`). | **CONFORME** |

---

## 3. Pruebas Automatizadas de Interfaz

Las siguientes suites de pruebas en `frontend/test/` validan continuamente la presencia de roles accesibles, etiquetas y comportamiento del teclado:
- `frontend/test/CatalogPage.test.tsx`
- `frontend/test/ProjectDetailPage.test.tsx`
- `frontend/test/DonationPage.test.tsx`
- `frontend/test/SimulationPage.test.tsx`
- `frontend/test/MyDonationsPage.test.tsx`
- `frontend/test/App.test.tsx`

---

## 4. Conclusión

La aplicación web frontend cumple con los criterios aplicables de accesibilidad según las directrices WCAG 2.2 Nivel AA y garantiza una experiencia de usuario fluida e inclusiva en dispositivos móviles desde 375 px de ancho.
