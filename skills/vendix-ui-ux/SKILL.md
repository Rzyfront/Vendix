---
name: vendix-ui-ux
description: >
  Mobile-first UI/UX design philosophy, accessibility standards, and visual design patterns for Vendix.
  The principal skill for mobile-first responsive development across all Vendix apps.
  Trigger: When designing UI screens, implementing mobile-first layouts, checking accessibility, or creating landing pages.
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke: "Designing UI screens, mobile-first layouts, accessibility review, landing pages, UX patterns"
---

# Vendix UI/UX — Mobile-First Design Skill

> **Skill principal de diseño mobile-first** — Filosofía de diseño, accesibilidad, patrones UX y checklist de calidad visual para todas las apps Vendix.

Esta skill define los **principios y estándares de diseño** para Vendix. Para implementación técnica de componentes específicos, consulta las skills complementarias listadas en cada sección.

---

## 1. Filosofía de Diseño

Antes de escribir código, define una dirección clara:

### Análisis de Contexto

- **QUIÉN** lo usa — persona, nivel de experiencia, contexto del dispositivo (móvil en tienda, desktop admin)
- **QUÉ** acción debe tomar — un solo objetivo primario por pantalla
- **POR QUÉ** debería confiar/interactuar — propuesta de valor clara

### Compromiso Estético

Elige y COMPROMÉTETE con una dirección visual. El diseño tímido falla:

- **Minimal funcional** — Stripe, Linear (ideal para dashboards SaaS)
- **Editorial maximista** — Bloomberg (dashboards de datos densos)
- **Orgánico/natural** — terroso, texturas (ecommerce artesanal)
- **Lujo/refinado** — marcas premium (ecommerce de moda)
- **Playful** — Figma, Notion (apps interactivas)
- **Industrial/utilitario** — denso en datos, funcional (POS, inventario)

### El Test de Memorabilidad

> ¿Qué UNA cosa recordarán los usuarios? Si no puedes responder esto, el diseño carece de foco.

### Vendix App Context

| App               | Contexto de uso                       | Prioridad UX                                    |
| ----------------- | ------------------------------------- | ----------------------------------------------- |
| `STORE_ECOMMERCE` | Cliente en móvil, comprando           | Velocidad, simplicidad, conversión              |
| `STORE_ADMIN`     | Dueño de tienda, móvil/tablet/desktop | Eficiencia, datos densos, acciones rápidas      |
| `STORE_POS`       | Vendedor en tienda, tablet/desktop    | Velocidad extrema, touch-first, mínima fricción |
| `ORG_ADMIN`       | Administrador, desktop                | Datos complejos, multi-tienda, reportes         |

> **📎 Skill complementaria:** `vendix-app-architecture` — Detalles completos de cada app y su dominio.

---

## 2. Mobile-First como Estándar

**REGLA ABSOLUTA:** Todo desarrollo en Vendix es mobile-first. Los estilos base son para móvil, y se añaden capas para pantallas más grandes.

### Principio de Diseño Responsivo

```
Mobile (base)  →  Tablet (sm/md)  →  Desktop (lg+)
  Stack              Adapt              Expand
  Simplify           Reveal             Enrich
```

### Breakpoints Vendix (vía PrimeNG + CSS)

| Breakpoint | Valor    | Uso                                 |
| ---------- | -------- | ----------------------------------- |
| Base       | `0px`    | Móvil — estilos por defecto         |
| `sm`       | `640px`  | Móvil grande / tablet pequeña       |
| `md`       | `768px`  | Tablet — cambio de layout principal |
| `lg`       | `1024px` | Desktop                             |
| `xl`       | `1280px` | Desktop grande                      |

### Patrón SCSS Mobile-First

```scss
// ✅ CORRECTO — Mobile-first
.my-component {
  padding: 1rem; // Móvil: padding compacto
  display: flex;
  flex-direction: column; // Móvil: apilar verticalmente

  @media (min-width: 768px) {
    padding: 1.5rem;
    flex-direction: row; // Tablet+: fila horizontal
  }

  @media (min-width: 1024px) {
    padding: 2rem; // Desktop: más espacio
  }
}

// ❌ INCORRECTO — Desktop-first
.my-component {
  padding: 2rem;
  flex-direction: row;

  @media (max-width: 768px) {
    // Nunca usar max-width como base
    padding: 1rem;
    flex-direction: column;
  }
}
```

### Patrón de Responsive Data View (Mobile ↔ Desktop)

Vendix tiene un sistema automático de cambio vista-tabla/vista-cards:

- **Desktop (≥768px):** `TableComponent` — tabla completa
- **Mobile (<768px):** `ItemListComponent` — cards con avatar, detalles y acciones

> **📎 Skill complementaria:** `vendix-frontend-data-display` — Configuración completa de `ResponsiveDataViewComponent`, `TableColumn`, `ItemListCardConfig`.

### Z-Index Stack System (Mobile Sticky)

```
┌──────────────────────────────────────────┐
│  z-30  Sticky Header (detail pages)      │  ← vendix-frontend-sticky-header
├──────────────────────────────────────────┤
│  z-20  Stats Container (sticky mobile)   │  ← vendix-frontend-stats-cards
├──────────────────────────────────────────┤
│  z-10  Search/Filter Bar (sticky)        │  ← vendix-frontend-standard-module
├──────────────────────────────────────────┤
│  z-0   Content (scroll normal)           │
└──────────────────────────────────────────┘
```

> **📎 Skills complementarias:**
>
> - `vendix-frontend-standard-module` — Layout completo del módulo estándar con sticky zones
> - `vendix-frontend-stats-cards` — Stats con scroll horizontal en móvil, grid en desktop
> - `vendix-frontend-sticky-header` — Header glassmorphism para páginas de detalle

---

## 3. Sistema de Tokens de Diseño

Vendix usa CSS custom properties gestionadas por `ThemeService`. **Nunca hardcodear colores.**

### Variables CSS (vía ThemeService)

```scss
// Colores — SIEMPRE usar variables
color: var(--color-text-primary);
background: var(--color-background);
border-color: var(--color-border);

// ❌ PROHIBIDO
color: #333;
background: white;
```

### Escala de Tipografía

```
12px — captions, labels (--font-size-xs)
14px — texto secundario (--font-size-sm)
16px — body text, MÍNIMO para móvil (--font-size-base)
18px — párrafos lead (--font-size-lg)
20px — H4
24px — H3
32px — H2
40px — H1
56px — Display (landing pages)
```

**Reglas de Tipografía:**

- Line height: `1.5–1.6` para body, `1.1–1.2` para headings
- Longitud de línea: 45–75 caracteres (`max-width: 65ch` o similar)
- Máximo 2–3 typefaces por diseño
- Body text en móvil: **mínimo 16px** (previene zoom automático en iOS)

### Escala de Espaciado (base 8px)

```
4px   — space-1  (micro-separaciones)
8px   — space-2  (entre elementos relacionados)
12px  — space-3  (padding compacto)
16px  — space-4  (padding estándar móvil)
24px  — space-6  (padding estándar desktop)
32px  — space-8  (separación de secciones)
48px  — space-12 (gap entre secciones)
64px  — space-16 (secciones landing)
96px  — space-24 (secciones landing grandes)
```

### Sombras Consistentes

```scss
// Sombra estándar Vendix (stats, cards, inputs en móvil)
box-shadow: 0 2px 8px rgba(0, 0, 0, 0.07);

// Sombra elevada (modales, dropdowns)
box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
```

### Regla 60-30-10 para Color

- **60%** color dominante (background, surface)
- **30%** color secundario (cards, secciones alternas)
- **10%** color accent (CTAs, highlights, badges)

> **📎 Skill complementaria:** `vendix-frontend-theme` — Implementación completa de `ThemeService`, branding multi-tenant, fuentes y CSS custom.

---

## 4. Requerimientos de Accesibilidad (No Negociables)

Estos son requerimientos DUROS, no sugerencias.

### Contraste de Color (WCAG 2.1 AA)

| Elemento                         | Ratio Mínimo |
| -------------------------------- | ------------ |
| Texto body                       | 4.5:1        |
| Texto grande (18pt+ o 14pt bold) | 3:1          |
| Componentes UI, iconos           | 3:1          |
| Indicadores de foco              | 3:1          |

### Touch Targets (Crítico para Mobile-First)

- **Tamaño mínimo:** 44×44px (Apple/WCAG) o 48×48dp (Material)
- **Espaciado mínimo:** 8px entre targets adyacentes
- El touch target puede extenderse más allá del boundary visual via padding

```scss
// ✅ Botón con touch target correcto
.action-button {
  min-height: 44px;
  min-width: 44px;
  padding: 12px 16px; // Extiende el área táctil
}

// ❌ Botón demasiado pequeño
.tiny-button {
  height: 28px; // < 44px = FALLO de accesibilidad
  padding: 4px;
}
```

### Elementos Interactivos

- TODOS los elementos interactivos DEBEN tener estados de foco visibles
- NUNCA usar `outline: none` sin un reemplazo
- Indicadores de foco: 3:1 contraste contra colores adyacentes
- Tab order lógico (evitar `tabindex` > 0)

### Formularios

- Cada input DEBE tener un `<label>` asociado (no solo placeholder)
- Mensajes de error asociados programáticamente (`aria-describedby`)
- No deshabilitar botones de submit antes del intento del usuario
- Usar atributos `autocomplete` apropiadamente

> **📎 Skill complementaria:** `vendix-angular-forms` — Implementación de Reactive Forms con tipado estricto y `FormControl<T>`.

### Imágenes e Iconos

- Imágenes significativas: `alt` descriptivo
- Imágenes decorativas: `alt=""` o `aria-hidden="true"`
- Botones solo-icono: `aria-label` obligatorio

```html
<!-- ✅ CORRECTO -->
<button type="button" aria-label="Eliminar producto">
  <app-icon name="trash-2" />
</button>

<!-- ❌ INCORRECTO -->
<div (click)="delete()">
  <app-icon name="trash-2" />
</div>
```

> **📎 Skill complementaria:** `vendix-frontend-icons` — Protocolo para registrar y usar iconos Lucide con `<app-icon>`.

### HTML Semántico

```html
<!-- ✅ CORRECTO -->
<button type="button" (click)="doAction()">Acción</button>
<a [routerLink]="['/products']">Ver productos</a>

<!-- ❌ INCORRECTO — Nunca hacer esto -->
<div (click)="doAction()">Acción</div>
<span class="link" (click)="navigate()">Ver productos</span>
```

**Primera regla de ARIA:** No uses ARIA si el HTML nativo funciona.

---

## 5. Patrones de Animación

### Duraciones

```scss
$duration-instant: 50ms; // Feedback inmediato
$duration-fast: 100ms; // Clicks de botón, toggles
$duration-normal: 200ms; // La mayoría de transiciones
$duration-slow: 300ms; // Modales, drawers
$duration-slower: 500ms; // Transiciones de página
```

### Reglas de Animación

- Feedback de botón: 100–150ms (debe sentirse instantáneo)
- **SOLO** animar `transform` y `opacity` (acelerado por GPU)
- **NUNCA** animar `width`, `height`, `margin`, `padding` (provocan reflow)
- Respetar `prefers-reduced-motion`

```scss
// ✅ Animación correcta
.card-enter {
  transition:
    transform 200ms ease-out,
    opacity 200ms ease-out;
}

// ✅ Respetar preferencia de movimiento reducido
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}

// ❌ Animación que causa reflow
.bad-animation {
  transition:
    width 300ms,
    height 300ms; // NUNCA
}
```

### Curvas de Easing

```scss
$ease-default: cubic-bezier(0.4, 0, 0.2, 1); // General
$ease-in: cubic-bezier(0.4, 0, 1, 1); // Elementos saliendo
$ease-out: cubic-bezier(0, 0, 0.2, 1); // Elementos entrando
$ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1); // Efecto rebote
```

> **📎 Skill complementaria:** `vendix-frontend-modal` — Patrones de apertura/cierre de modales con animación.

---

## 6. Patrones SaaS Dashboard

### Arquitectura de Layout

```
┌──────────────────────────────────────────────────┐
│ Top Bar (56-64px): Logo, Search, User Menu       │
├───────────┬──────────────────────────────────────┤
│ Sidebar   │  Main Content Area                   │
│ 240-280px │  (con breadcrumbs si hay deep nav)   │
│ collapsed │                                      │
│ 64-80px   │  Cards / Data / Forms                │
│           │                                      │
└───────────┴──────────────────────────────────────┘
```

**Mobile:** Sidebar colapsa completamente, accesible via hamburger menu.

### Guías de Navegación

| Escenario          | Patrón              |
| ------------------ | ------------------- |
| 10+ secciones      | Sidebar colapsable  |
| 3–6 secciones      | Navegación superior |
| Nav secundario     | Tabs (máx 6)        |
| Jerarquía profunda | Breadcrumbs         |

### Jerarquía de Contenido en Dashboard

1. **Métricas value-first:** "Ahorraste 4 horas" > números crudos
2. **Insights accionables:** ¿Qué debe hacer el usuario ahora?
3. **Revelación progresiva:** Resumen → Detalle bajo demanda
4. **Vistas por rol:** Diferentes personas necesitan diferentes datos

### Visualización de Datos

- Colores semánticos: rojo=negativo, verde=positivo (con patrón/icono backup para daltonismo)
- Siempre incluir leyendas
- Labels de ejes son obligatorios
- Truncar labels largos con tooltips

### Empty States

```html
<!-- ✅ BUENO: Útil, orientado a la acción -->
<div class="empty-state">
  <app-icon name="inbox" [size]="48" />
  <h3>No hay mensajes aún</h3>
  <p>Cuando recibas mensajes, aparecerán aquí.</p>
  <app-button label="Componer mensaje" (onClick)="compose()" />
</div>

<!-- ❌ MALO: Sin ayuda -->
<p>No hay datos</p>
```

### Páginas de Settings

- Layout bucket + side panel para settings complejos
- Agrupar acciones destructivas en "Zona de Peligro" al fondo
- Confirmaciones destructivas: requieren typing, labels específicos ("Eliminar cuenta" no "Sí")

### Toast / Notificaciones

- Default: 4–5 segundos
- Mínimo para accesibilidad: 6 segundos
- Fórmula: 500ms por palabra + 3 segundos base
- Siempre incluir botón de dismiss

> **📎 Skills complementarias:**
>
> - `vendix-frontend-standard-module` — Layout completo de módulo admin con stats + table
> - `vendix-frontend-stats-cards` — Implementación de `StatsComponent` con colores semánticos
> - `vendix-settings-system` — Sistema de configuración `store_settings` / `organization_settings`

---

## 7. Patrones de Landing Page (Ecommerce)

### Above-the-Fold Essentials

Debe contener dentro del viewport:

1. Headline claro (5–10 palabras)
2. Subheadline de soporte (propuesta de valor)
3. Un solo CTA primario
4. Elemento visual (hero image, producto, ilustración)

### Flujo de Secciones

```
1. Hero (headline + CTA + visual)
2. Social Proof (logos, snippet de testimonial)
3. Problema/Solución
4. Features/Beneficios (3–4 máximo)
5. Testimonials detallados
6. Pricing (si aplica)
7. FAQ
8. CTA Final
9. Footer
```

### Diseño de Botón CTA

- **Tamaño:** Mínimo 44px de alto, padding 2× el font size
- **Color:** Alto contraste, colores cálidos crean urgencia
- **Copy:** Verbos de acción, primera persona ("Obtener mi prueba gratis" > "Registrarse")
- **Longitud:** 2–5 palabras máximo
- Un CTA primario por viewport

### Placement de Social Proof

- Logo bar: Inmediatamente después del hero
- Testimonials: Cerca de puntos de objeción
- Stats: Cerca de pricing
- Trust badges: Cerca de formularios/checkout

### Tablas de Pricing

- 3–4 tiers máximo (más causa parálisis)
- Destacar tier recomendado ("Más Popular")
- Toggle anual/mensual con ahorro mostrado
- Checkmarks para escaneo rápido de features
- Botón CTA en cada tier

### Optimización de Formularios

- Layout de una sola columna (120% menos errores que multi-columna)
- Minimizar campos (4 campos vs 11 = 120% más conversiones)
- Nunca pedir teléfono si no es esencial (58% abandono)
- Labels encima de inputs
- Validar on blur, no mientras se escribe

> **📎 Skill complementaria:** `vendix-ecommerce-checkout` — Flujo completo de checkout para ecommerce.

---

## 8. Anti-Patrones (NUNCA HACER)

### Anti-Patrones Visuales

- ❌ Gradientes púrpura/azul genéricos sobre blanco (cliché de IA)
- ❌ Border-radius inconsistente (elige uno: 4px, 8px o 12px y mantenerlo)
- ❌ Sombras que no coinciden con fuente de luz
- ❌ Más de 3 font weights
- ❌ Esquemas de color arcoíris sin propósito
- ❌ Hardcodear colores en lugar de usar `var(--color-*)`

### Anti-Patrones UX

- ❌ Confirmshaming ("No gracias, odio ahorrar dinero")
- ❌ Opciones pre-seleccionadas que benefician a la empresa sobre el usuario
- ❌ Cancelación más difícil que registro
- ❌ Indicadores falsos de urgencia/escasez
- ❌ Scroll infinito sin opción de paginación (rompe botón atrás, nav por teclado)
- ❌ Botones de submit deshabilitados antes del intento del usuario
- ❌ Placeholder text como labels

### Anti-Patrones Técnicos

- ❌ `outline: none` sin reemplazo de foco
- ❌ `<div (click)>` en lugar de `<button>`
- ❌ Animar propiedades de layout (`width`, `height`, `margin`)
- ❌ Leer propiedades de layout en loops (causa thrashing)
- ❌ `alt` faltante en imágenes
- ❌ Formularios sin labels
- ❌ Usar `max-width` media queries como base (desktop-first)

### Anti-Patrones Mobile

- ❌ Touch targets < 44×44px
- ❌ Body text < 16px
- ❌ Scroll horizontal en contenido (excepto carousels explícitos como stats)
- ❌ Sin feedback al tap (debe responder < 100ms)
- ❌ Elementos `position: fixed` bloqueando la thumb zone
- ❌ Modales que no son full-screen en viewport pequeño
- ❌ Inputs que causan zoom (font-size < 16px en iOS)

---

## 9. Checklist Pre-Entrega

Antes de entregar CUALQUIER código frontend, verificar:

### Accesibilidad ✓

- [ ] Contraste de color ≥ 4.5:1 (texto) / 3:1 (UI)
- [ ] Touch targets ≥ 44×44px
- [ ] Todas las imágenes tienen `alt`
- [ ] Todos los campos de formulario tienen `<label>`
- [ ] Estados de foco visibles en todos los elementos interactivos
- [ ] No hay información solo por color

### Diseño Visual ✓

- [ ] Jerarquía tipográfica clara (3–5 niveles)
- [ ] Espaciado consistente desde la escala de tokens
- [ ] Máximo 2–3 typefaces
- [ ] Paleta de color cohesiva (60-30-10)
- [ ] Usa `var(--color-*)` en vez de valores hardcodeados

### Mobile-First ✓

- [ ] Estilos base son para móvil (no desktop)
- [ ] Media queries usan `min-width` (no `max-width`)
- [ ] Body text ≥ 16px en móvil
- [ ] Touch targets ≥ 44px
- [ ] Sin scroll horizontal no intencional
- [ ] Inputs con `font-size: 16px` (previene zoom iOS)
- [ ] Modales responsivos (full-screen en móvil si necesario)

### Técnico ✓

- [ ] Animaciones solo usan `transform` / `opacity`
- [ ] `prefers-reduced-motion` respetado
- [ ] HTML semántico (botones son `<button>`, links son `<a>`)
- [ ] Sigue estructura de componente Angular (`vendix-frontend-component`)

### Integridad UX ✓

- [ ] Un solo objetivo primario por pantalla
- [ ] Sin dark patterns o confirmshaming
- [ ] Footer siempre accesible
- [ ] Estados de error son útiles y claros
- [ ] Estados de carga existen (skeleton > spinner)
- [ ] Empty states orientados a la acción

---

## 10. Mapa de Skills Complementarias

Esta skill define **qué** hacer (principios y estándares). Las siguientes skills definen **cómo** implementarlo:

### Implementación de Componentes

| Necesidad                | Skill                       | Descripción                               |
| ------------------------ | --------------------------- | ----------------------------------------- |
| Estructura de componente | `vendix-frontend-component` | Carpetas, naming, signals, OnPush         |
| Formularios tipados      | `vendix-angular-forms`      | Reactive Forms, `FormControl<T>`, getters |
| Modales                  | `vendix-frontend-modal`     | `ModalComponent`, apertura/cierre, NG0100 |
| Iconos                   | `vendix-frontend-icons`     | Registro y uso de Lucide con `<app-icon>` |

### Layout y Datos

| Necesidad                   | Skill                             | Descripción                               |
| --------------------------- | --------------------------------- | ----------------------------------------- |
| Módulo admin estándar       | `vendix-frontend-standard-module` | Stats + search + table, z-index stack     |
| Tablas y cards responsivas  | `vendix-frontend-data-display`    | `ResponsiveDataViewComponent` auto-switch |
| Stats con scroll horizontal | `vendix-frontend-stats-cards`     | `StatsComponent`, `.stats-container`      |
| Headers sticky              | `vendix-frontend-sticky-header`   | Glassmorphism, z-30, páginas detalle      |

### Theming y Estado

| Necesidad               | Skill                          | Descripción                           |
| ----------------------- | ------------------------------ | ------------------------------------- |
| Variables CSS, branding | `vendix-frontend-theme`        | `ThemeService`, multi-tenant branding |
| Estado NgRx             | `vendix-frontend-state`        | Reducers, actions, selectors, effects |
| Routing lazy            | `vendix-frontend-lazy-routing` | Rutas lazy-loaded para sub-módulos    |

### Contexto de Negocio

| Necesidad          | Skill                       | Descripción                                |
| ------------------ | --------------------------- | ------------------------------------------ |
| Apps y dominios    | `vendix-app-architecture`   | STORE_ADMIN, STORE_ECOMMERCE, POS, etc.    |
| Checkout ecommerce | `vendix-ecommerce-checkout` | Flujo completo de checkout                 |
| Settings           | `vendix-settings-system`    | `store_settings` / `organization_settings` |
| Pricing avanzado   | `vendix-product-pricing`    | Cálculos de rentabilidad y precios         |
