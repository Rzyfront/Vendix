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

# ⚠️ OBLIGATORIEDAD ABSOLUTA - LEER ANTES DE CONTINUAR

**ESTAS REGLAS NO SON OPCIONALES. SON OBLIGATORIAS.**

Este skill contiene estándares de DISEÑO Y UX que DEBEN seguirse en TODA la codebase de Vendix.
No importa si "funciona" — si no cumple con estas reglas, el código NO será aceptado.

###🚨 REGLAS CRÍTICAS (NO NEGOCIABLES):

1. **Mobile-First es OBLIGATORIO** — Si escribes estilos desktop-first (usando `max-width`), será rechazado
2. **Accesibilidad es OBLIGATORIA** — Contraste, touch targets 44px, labels en formularios, focus states
3. **Tokens de diseño son OBLIGATORIOS** — Usar `var(--color-*)`, nunca hardcodear colores
4. **HTML semántico es OBLIGATORIO** — `<button>` para acciones, `<a>` para enlaces, nunca `<div (click)>`
5. **Animaciones GPU son OBLIGATORIAS** — Solo `transform` y `opacity`, nunca `width/height/margin`
6. **Patrones de Skills son OBLIGATORIOS** — Usar TODOS los patrones descritos en skills complementarias (vendix-frontend-component, vendix-frontend-standard-module, vendix-frontend-data-display, vendix-frontend-stats-cards, vendix-frontend-theme, vendix-frontend-modal, vendix-frontend-icons, vendix-angular-forms, vendix-ecommerce-checkout, vendix-settings-system, vendix-product-pricing)

###📋 CHECKLIST OBLIGATORIO ANTES DE CADA PR:

- [ ] ¿Mi diseño es mobile-first? (base styles para móvil, no desktop)
- [ ] ¿Mi contraste cumple WCAG AA? (4.5:1 texto, 3:1 UI)
- [ ] ¿Mis touch targets son ≥ 44px?
- [ ] ¿Estoy usando variables CSS en vez de colores hardcodeados?
- [ ] ¿Todos mis formularios tienen labels?
- [ ] ¿Todos mis elementos interactivos tienen focus states visibles?
- [ ] ¿Estoy usando HTML semántico?
- [ ] ¿Estoy aplicando los patrones de las skills complementarias? (componentes, módulos estándar, tablas, stats, theming, modals, icons, formularios, checkout, settings, pricing)

**SI NO CUMPLES ESTAS REGLAS, EL CÓDIGO SERÁ RECHAZADO EN REVIEW.**

---

# Vendix UI/UX — Mobile-First Design Skill

> **Principal mobile-first design skill** — Design philosophy, accessibility, UX patterns, and visual quality checklist for all Vendix apps.

This skill defines the **design principles and standards** for Vendix. For technical implementation of specific components, refer to the complementary skills listed in each section.

---

## 1. Design Philosophy

Before writing code, define a clear direction:

### Context Analysis

- **WHO** uses it — persona, experience level, device context (mobile in-store, desktop admin)
- **WHAT** action they should take — a single primary goal per screen
- **WHY** they should trust/interact — clear value proposition

### Aesthetic Commitment

Choose and COMMIT to a visual direction. Timid design fails:

- **Functional minimal** — Stripe, Linear (ideal for SaaS dashboards)
- **Maximalist editorial** — Bloomberg (dense data dashboards)
- **Organic/natural** — earthy, textures (artisan ecommerce)
- **Luxury/refined** — premium brands (fashion ecommerce)
- **Playful** — Figma, Notion (interactive apps)
- **Industrial/utilitarian** — data-dense, functional (POS, inventory)

### The Memorability Test

> What ONE thing will users remember? If you can't answer this, the design lacks focus.

### Vendix App Context

| App               | Usage Context                        | UX Priority                                  |
| ----------------- | ------------------------------------ | -------------------------------------------- |
| `STORE_ECOMMERCE` | Customer on mobile, shopping         | Speed, simplicity, conversion                |
| `STORE_ADMIN`     | Store owner, mobile/tablet/desktop   | Efficiency, dense data, quick actions        |
| `STORE_POS`       | In-store salesperson, tablet/desktop | Extreme speed, touch-first, minimal friction |
| `ORG_ADMIN`       | Administrator, desktop               | Complex data, multi-store, reports           |

> **Complementary skill:** `vendix-app-architecture` — Full details of each app and its domain.

---

## 2. Mobile-First as Standard

**ABSOLUTE RULE:** All development in Vendix is mobile-first. Base styles are for mobile, and layers are added for larger screens.

### Responsive Design Principle

```
Mobile (base)  →  Tablet (sm/md)  →  Desktop (lg+)
  Stack              Adapt              Expand
  Simplify           Reveal             Enrich
```

### Vendix Breakpoints (via PrimeNG + CSS)

| Breakpoint | Value    | Usage                       |
| ---------- | -------- | --------------------------- |
| Base       | `0px`    | Mobile — default styles     |
| `sm`       | `640px`  | Large mobile / small tablet |
| `md`       | `768px`  | Tablet — main layout change |
| `lg`       | `1024px` | Desktop                     |
| `xl`       | `1280px` | Large desktop               |

### Mobile-First SCSS Pattern

```scss
// ✅ CORRECT — Mobile-first
.my-component {
  padding: 1rem; // Mobile: compact padding
  display: flex;
  flex-direction: column; // Mobile: stack vertically

  @media (min-width: 768px) {
    padding: 1.5rem;
    flex-direction: row; // Tablet+: horizontal row
  }

  @media (min-width: 1024px) {
    padding: 2rem; // Desktop: more space
  }
}

// ❌ INCORRECT — Desktop-first
.my-component {
  padding: 2rem;
  flex-direction: row;

  @media (max-width: 768px) {
    // Never use max-width as base
    padding: 1rem;
    flex-direction: column;
  }
}
```

### Responsive Data View Pattern (Mobile ↔ Desktop)

Vendix has an automatic table-view/card-view switching system:

- **Desktop (≥768px):** `TableComponent` — full table
- **Mobile (<768px):** `ItemListComponent` — cards with avatar, details, and actions

> **Complementary skill:** `vendix-frontend-data-display` — Full configuration of `ResponsiveDataViewComponent`, `TableColumn`, `ItemListCardConfig`.

### Z-Index Stack System (Mobile Sticky)

```
┌──────────────────────────────────────────┐
│  z-30  Sticky Header (detail pages)      │  ← vendix-frontend-sticky-header
├──────────────────────────────────────────┤
│  z-20  Stats Container (sticky mobile)   │  ← vendix-frontend-stats-cards
├──────────────────────────────────────────┤
│  z-10  Search/Filter Bar (sticky)        │  ← vendix-frontend-standard-module
├──────────────────────────────────────────┤
│  z-0   Content (normal scroll)           │
└──────────────────────────────────────────┘
```

> **Complementary skills:**
>
> - `vendix-frontend-standard-module` — Full standard module layout with sticky zones
> - `vendix-frontend-stats-cards` — Stats with horizontal scroll on mobile, grid on desktop
> - `vendix-frontend-sticky-header` — Glassmorphism header for detail pages

---

## 3. Design Token System

Vendix uses CSS custom properties managed by `ThemeService`. **Never hardcode colors.**

### CSS Variables (via ThemeService)

```scss
// Colors — ALWAYS use variables
color: var(--color-text-primary);
background: var(--color-background);
border-color: var(--color-border);

// ❌ FORBIDDEN
color: #333;
background: white;
```

### Typography Scale

```
12px — captions, labels (--font-size-xs)
14px — secondary text (--font-size-sm)
16px — body text, MINIMUM for mobile (--font-size-base)
18px — lead paragraphs (--font-size-lg)
20px — H4
24px — H3
32px — H2
40px — H1
56px — Display (landing pages)
```

**Typography Rules:**

- Line height: `1.5–1.6` for body, `1.1–1.2` for headings
- Line length: 45–75 characters (`max-width: 65ch` or similar)
- Maximum 2–3 typefaces per design
- Body text on mobile: **minimum 16px** (prevents automatic zoom on iOS)

### Spacing Scale (base 8px)

```
4px   — space-1  (micro-separations)
8px   — space-2  (between related elements)
12px  — space-3  (compact padding)
16px  — space-4  (standard mobile padding)
24px  — space-6  (standard desktop padding)
32px  — space-8  (section separation)
48px  — space-12 (gap between sections)
64px  — space-16 (landing sections)
96px  — space-24 (large landing sections)
```

### Consistent Shadows

```scss
// Standard Vendix shadow (stats, cards, inputs on mobile)
box-shadow: 0 2px 8px rgba(0, 0, 0, 0.07);

// Elevated shadow (modals, dropdowns)
box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
```

### 60-30-10 Color Rule

- **60%** dominant color (background, surface)
- **30%** secondary color (cards, alternating sections)
- **10%** accent color (CTAs, highlights, badges)

> **Complementary skill:** `vendix-frontend-theme` — Full implementation of `ThemeService`, multi-tenant branding, fonts, and custom CSS.

---

## 4. Accessibility Requirements (Non-Negotiable)

These are HARD requirements, not suggestions.

### Color Contrast (WCAG 2.1 AA)

| Element                         | Minimum Ratio |
| ------------------------------- | ------------- |
| Body text                       | 4.5:1         |
| Large text (18pt+ or 14pt bold) | 3:1           |
| UI components, icons            | 3:1           |
| Focus indicators                | 3:1           |

### Touch Targets (Critical for Mobile-First)

- **Minimum size:** 44×44px (Apple/WCAG) or 48×48dp (Material)
- **Minimum spacing:** 8px between adjacent targets
- The touch target can extend beyond the visual boundary via padding

```scss
// ✅ Button with correct touch target
.action-button {
  min-height: 44px;
  min-width: 44px;
  padding: 12px 16px; // Extends the touch area
}

// ❌ Button too small
.tiny-button {
  height: 28px; // < 44px = accessibility FAILURE
  padding: 4px;
}
```

### Interactive Elements

- ALL interactive elements MUST have visible focus states
- NEVER use `outline: none` without a replacement
- Focus indicators: 3:1 contrast against adjacent colors
- Logical tab order (avoid `tabindex` > 0)

### Forms

- Every input MUST have an associated `<label>` (not just placeholder)
- Error messages programmatically associated (`aria-describedby`)
- Do not disable submit buttons before the user's attempt
- Use `autocomplete` attributes appropriately

> **Complementary skill:** `vendix-angular-forms` — Reactive Forms implementation with strict typing and `FormControl<T>`.

### Images and Icons

- Meaningful images: descriptive `alt`
- Decorative images: `alt=""` or `aria-hidden="true"`
- Icon-only buttons: `aria-label` is mandatory

```html
<!-- ✅ CORRECT -->
<button type="button" aria-label="Delete product">
  <app-icon name="trash-2" />
</button>

<!-- ❌ INCORRECT -->
<div (click)="delete()">
  <app-icon name="trash-2" />
</div>
```

> **Complementary skill:** `vendix-frontend-icons` — Protocol for registering and using Lucide icons with `<app-icon>`.

### Semantic HTML

```html
<!-- ✅ CORRECT -->
<button type="button" (click)="doAction()">Action</button>
<a [routerLink]="['/products']">View products</a>

<!-- ❌ INCORRECT — Never do this -->
<div (click)="doAction()">Action</div>
<span class="link" (click)="navigate()">View products</span>
```

**First rule of ARIA:** Don't use ARIA if native HTML works.

---

## 5. Animation Patterns

### Durations

```scss
$duration-instant: 50ms; // Immediate feedback
$duration-fast: 100ms; // Button clicks, toggles
$duration-normal: 200ms; // Most transitions
$duration-slow: 300ms; // Modals, drawers
$duration-slower: 500ms; // Page transitions
```

### Animation Rules

- Button feedback: 100–150ms (must feel instantaneous)
- **ONLY** animate `transform` and `opacity` (GPU-accelerated)
- **NEVER** animate `width`, `height`, `margin`, `padding` (causes reflow)
- Respect `prefers-reduced-motion`

```scss
// ✅ Correct animation
.card-enter {
  transition:
    transform 200ms ease-out,
    opacity 200ms ease-out;
}

// ✅ Respect reduced motion preference
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}

// ❌ Animation that causes reflow
.bad-animation {
  transition:
    width 300ms,
    height 300ms; // NEVER
}
```

### Easing Curves

```scss
$ease-default: cubic-bezier(0.4, 0, 0.2, 1); // General
$ease-in: cubic-bezier(0.4, 0, 1, 1); // Elements exiting
$ease-out: cubic-bezier(0, 0, 0.2, 1); // Elements entering
$ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1); // Bounce effect
```

> **Complementary skill:** `vendix-frontend-modal` — Modal open/close patterns with animation.

---

## 6. SaaS Dashboard Patterns

### Layout Architecture

```
┌──────────────────────────────────────────────────┐
│ Top Bar (56-64px): Logo, Search, User Menu       │
├───────────┬──────────────────────────────────────┤
│ Sidebar   │  Main Content Area                   │
│ 240-280px │  (with breadcrumbs if deep nav)      │
│ collapsed │                                      │
│ 64-80px   │  Cards / Data / Forms                │
│           │                                      │
└───────────┴──────────────────────────────────────┘
```

**Mobile:** Sidebar collapses completely, accessible via hamburger menu.

### Navigation Guidelines

| Scenario       | Pattern             |
| -------------- | ------------------- |
| 10+ sections   | Collapsible sidebar |
| 3–6 sections   | Top navigation      |
| Secondary nav  | Tabs (max 6)        |
| Deep hierarchy | Breadcrumbs         |

### Dashboard Content Hierarchy

1. **Value-first metrics:** "You saved 4 hours" > raw numbers
2. **Actionable insights:** What should the user do now?
3. **Progressive disclosure:** Summary → Detail on demand
4. **Role-based views:** Different personas need different data

### Data Visualization

- Semantic colors: red=negative, green=positive (with pattern/icon backup for color blindness)
- Always include legends
- Axis labels are mandatory
- Truncate long labels with tooltips

### Empty States

```html
<!-- ✅ GOOD: Helpful, action-oriented -->
<div class="empty-state">
  <app-icon name="inbox" [size]="48" />
  <h3>No messages yet</h3>
  <p>When you receive messages, they will appear here.</p>
  <app-button label="Compose message" (onClick)="compose()" />
</div>

<!-- ❌ BAD: No help -->
<p>No data</p>
```

### Settings Pages

- Bucket + side panel layout for complex settings
- Group destructive actions in a "Danger Zone" at the bottom
- Destructive confirmations: require typing, specific labels ("Delete account" not "Yes")

### Toast / Notifications

- Default: 4–5 seconds
- Minimum for accessibility: 6 seconds
- Formula: 500ms per word + 3 seconds base
- Always include a dismiss button

> **Complementary skills:**
>
> - `vendix-frontend-standard-module` — Full admin module layout with stats + table
> - `vendix-frontend-stats-cards` — `StatsComponent` implementation with semantic colors
> - `vendix-settings-system` — `store_settings` / `organization_settings` configuration system

---

## 7. Landing Page Patterns (Ecommerce)

### Above-the-Fold Essentials

Must contain within the viewport:

1. Clear headline (5–10 words)
2. Supporting subheadline (value proposition)
3. A single primary CTA
4. Visual element (hero image, product, illustration)

### Section Flow

```
1. Hero (headline + CTA + visual)
2. Social Proof (logos, testimonial snippet)
3. Problem/Solution
4. Features/Benefits (3–4 maximum)
5. Detailed Testimonials
6. Pricing (if applicable)
7. FAQ
8. Final CTA
9. Footer
```

### CTA Button Design

- **Size:** Minimum 44px height, padding 2× the font size
- **Color:** High contrast, warm colors create urgency
- **Copy:** Action verbs, first person ("Get my free trial" > "Sign up")
- **Length:** 2–5 words maximum
- One primary CTA per viewport

### Social Proof Placement

- Logo bar: Immediately after the hero
- Testimonials: Near objection points
- Stats: Near pricing
- Trust badges: Near forms/checkout

### Pricing Tables

- 3–4 tiers maximum (more causes paralysis)
- Highlight recommended tier ("Most Popular")
- Annual/monthly toggle with savings shown
- Checkmarks for quick feature scanning
- CTA button on each tier

### Form Optimization

- Single-column layout (120% fewer errors than multi-column)
- Minimize fields (4 fields vs 11 = 120% more conversions)
- Never ask for phone if not essential (58% abandonment)
- Labels above inputs
- Validate on blur, not while typing

> **Complementary skill:** `vendix-ecommerce-checkout` — Full checkout flow for ecommerce.

---

## 8. Anti-Patterns (NEVER DO)

### Visual Anti-Patterns

- ❌ Generic purple/blue gradients on white (AI cliche)
- ❌ Inconsistent border-radius (pick one: 4px, 8px, or 12px and stick with it)
- ❌ Shadows that don't match light source
- ❌ More than 3 font weights
- ❌ Rainbow color schemes without purpose
- ❌ Hardcoding colors instead of using `var(--color-*)`

### UX Anti-Patterns

- ❌ Confirmshaming ("No thanks, I hate saving money")
- ❌ Pre-selected options that benefit the company over the user
- ❌ Cancellation harder than sign-up
- ❌ False urgency/scarcity indicators
- ❌ Infinite scroll without pagination option (breaks back button, keyboard nav)
- ❌ Disabled submit buttons before the user's attempt
- ❌ Placeholder text as labels

### Technical Anti-Patterns

- ❌ `outline: none` without focus replacement
- ❌ `<div (click)>` instead of `<button>`
- ❌ Animating layout properties (`width`, `height`, `margin`)
- ❌ Reading layout properties in loops (causes thrashing)
- ❌ Missing `alt` on images
- ❌ Forms without labels
- ❌ Using `max-width` media queries as base (desktop-first)

### Mobile Anti-Patterns

- ❌ Touch targets < 44×44px
- ❌ Body text < 16px
- ❌ Horizontal scroll on content (except explicit carousels like stats)
- ❌ No tap feedback (must respond < 100ms)
- ❌ `position: fixed` elements blocking the thumb zone
- ❌ Modals that are not full-screen on small viewports
- ❌ Inputs that cause zoom (font-size < 16px on iOS)

---

## 9. Pre-Delivery Checklist

Before delivering ANY frontend code, verify:

### Accessibility ✓

- [ ] Color contrast ≥ 4.5:1 (text) / 3:1 (UI)
- [ ] Touch targets ≥ 44×44px
- [ ] All images have `alt`
- [ ] All form fields have `<label>`
- [ ] Visible focus states on all interactive elements
- [ ] No color-only information

### Visual Design ✓

- [ ] Clear typographic hierarchy (3–5 levels)
- [ ] Consistent spacing from token scale
- [ ] Maximum 2–3 typefaces
- [ ] Cohesive color palette (60-30-10)
- [ ] Uses `var(--color-*)` instead of hardcoded values

### Mobile-First ✓

- [ ] Base styles are for mobile (not desktop)
- [ ] Media queries use `min-width` (not `max-width`)
- [ ] Body text ≥ 16px on mobile
- [ ] Touch targets ≥ 44px
- [ ] No unintentional horizontal scroll
- [ ] Inputs with `font-size: 16px` (prevents iOS zoom)
- [ ] Responsive modals (full-screen on mobile if needed)

### Technical ✓

- [ ] Animations only use `transform` / `opacity`
- [ ] `prefers-reduced-motion` respected
- [ ] Semantic HTML (buttons are `<button>`, links are `<a>`)
- [ ] Follows Angular component structure (`vendix-frontend-component`)

### UX Integrity ✓

- [ ] Single primary goal per screen
- [ ] No dark patterns or confirmshaming
- [ ] Footer always accessible
- [ ] Error states are helpful and clear
- [ ] Loading states exist (skeleton > spinner)
- [ ] Action-oriented empty states

---

## 10. Complementary Skills Map

This skill defines **what** to do (principles and standards). The following skills define **how** to implement it:

### Component Implementation

| Need                             | Skill                        | Description                                                        |
| -------------------------------- | ---------------------------- | ------------------------------------------------------------------ |
| **Zoneless + Signals (CRÍTICO)** | **`vendix-zoneless-signals`** | **Patrones Angular 20: input/output/model, toSignal, CVA, @defer** |
| Component structure              | `vendix-frontend-component`  | Folders, naming, signals, OnPush                                   |
| Typed forms                      | `vendix-angular-forms`       | Reactive Forms, `FormControl<T>`, getters                          |
| Modals                           | `vendix-frontend-modal`      | `ModalComponent`, open/close, NG0100                               |
| Icons                            | `vendix-frontend-icons`      | Registration and usage of Lucide with `<app-icon>`                 |

### Layout and Data

| Need                         | Skill                             | Description                               |
| ---------------------------- | --------------------------------- | ----------------------------------------- |
| Standard admin module        | `vendix-frontend-standard-module` | Stats + search + table, z-index stack     |
| Responsive tables and cards  | `vendix-frontend-data-display`    | `ResponsiveDataViewComponent` auto-switch |
| Stats with horizontal scroll | `vendix-frontend-stats-cards`     | `StatsComponent`, `.stats-container`      |
| Sticky headers               | `vendix-frontend-sticky-header`   | Glassmorphism, z-30, detail pages         |

### Theming and State

| Need                    | Skill                          | Description                           |
| ----------------------- | ------------------------------ | ------------------------------------- |
| CSS variables, branding | `vendix-frontend-theme`        | `ThemeService`, multi-tenant branding |
| NgRx state              | `vendix-frontend-state`        | Reducers, actions, selectors, effects |
| Lazy routing            | `vendix-frontend-lazy-routing` | Lazy-loaded routes for sub-modules    |

### Business Context

| Need               | Skill                       | Description                                |
| ------------------ | --------------------------- | ------------------------------------------ |
| Apps and domains   | `vendix-app-architecture`   | STORE_ADMIN, STORE_ECOMMERCE, POS, etc.    |
| Ecommerce checkout | `vendix-ecommerce-checkout` | Full checkout flow                         |
| Settings           | `vendix-settings-system`    | `store_settings` / `organization_settings` |
| Advanced pricing   | `vendix-product-pricing`    | Profitability and pricing calculations     |
