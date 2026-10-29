---
name: vendix-ui-ux
description: >
  Vendix Soft UI design language (POS look, tokens only, multibrand), mobile-first, accessibility and frontend skill routing. Trigger: designing or building any UI, screen or shared component, UX review.
license: MIT
metadata:
  author: rzyfront
  version: "3.0"
  scope: [root]
  auto_invoke: "Designing UI screens, mobile-first layouts, accessibility review, landing pages, UX patterns"
---

# Vendix UI/UX

## Purpose

This is the broad design checklist. For implementation details, use the specialized frontend skills listed below.

## Design Language: Vendix Soft UI (mandatory for new UI)

Every new screen and shared component follows **Soft UI**, the look of the POS (`/admin/pos`): soft,
clean, tinted, symmetric. Full spec, recipes and scales: [references/soft-ui.md](references/soft-ui.md)
— read it before designing or styling UI. Existing screens migrate over time; don't restyle them
unless the task asks.

- **Tokens only.** No hex, `rgb()/rgba()`, raw `px` or Tailwind arbitrary values
  (`text-[11px]`, `rounded-[10px]`, `shadow-[…]`). Missing value ⇒ add a token, never inline it.
- **Multibrand.** Brand accents are `primary` + alpha (`bg-primary/10 border-primary/25
  text-primary`), never a fixed hue; surfaces are `bg-surface`, never white. Works in every tenant
  brand, dark mode and preset.
- **Tint, don't fill.** One solid primary action per view; the rest is tinted, neutral or ghost.
- **Radius scale:** `rounded-md` (10px) icon buttons · `rounded-xl` (12px) controls ·
  `rounded-2xl` (16px) cards/modals · `rounded-full` pills. Not `rounded-lg` (14px, off-scale).
- **Alpha steps:** `/5` quiet · `/10` resting · `/15` hover · `/20` strong/ring · `/25` border.
- **Heights:** 24/28px icon buttons · 32px pills/compact · 40px mobile / 44px desktop controls.
  Same row ⇒ same height and radius.
- **Borders 1px**, no shadow at rest (`shadow-2xs` hairline at most on controls, `shadow-sm` on card
  hover). Labels on a brand tint use `text-primary-on-tint` (legible with any brand and in dark).
- **Type:** `text-xs font-semibold` labels, `text-sm` control text, `font-bold` only for numbers
  and headings. Icons 12–14 in small controls, 16 in 40–44px.
- **Destructive** uses the `error` token tinted (`bg-error/10 border-error/25 text-error`), not
  `rose-*`/`red-*`. Badges use `<app-badge>` semantic variants.

## Core Standards

- Mobile-first base styles; add larger-screen behavior with `min-width` media queries.
- Semantic HTML: actions use `button`, navigation uses `a`/router links.
- Accessible touch targets: at least 44px where practical.
- Visible focus states; never remove outlines without replacement.
- Form fields need labels, not placeholders only.
- Use theme tokens (Tailwind token classes or `var(--…)`) for every color, radius, shadow, size and
  font value; never hardcoded CSS.
- Animate `transform` and `opacity`; avoid layout-property animations.
- Respect `prefers-reduced-motion` for substantial motion.

## App Context

| App | Priority |
| --- | --- |
| `STORE_ECOMMERCE` | Mobile conversion, speed, trust |
| `STORE_ADMIN` | Efficient admin workflows across mobile/desktop; POS screens inside it are touch-first, low friction |
| `STORE_DELIVERY` | Carrier (repartidor) app, mobile-first |
| `ORG_ADMIN` | Dense data, reporting, multi-store management |

## Mobile-First Checklist

- Base layout works on narrow screens.
- Body/input text avoids iOS zoom issues.
- Cards/tables do not create accidental horizontal overflow.
- Sticky elements do not block primary actions.
- Primary action is reachable and visually clear.

## Accessibility Checklist

- Text contrast targets WCAG AA.
- Icon-only buttons have `aria-label`.
- Images have meaningful `alt` or are marked decorative.
- Errors are clear and associated with fields where possible.
- UI state is not communicated by color alone.

## Visual Quality Checklist

- One primary goal per screen.
- Clear hierarchy: title, supporting text, primary action, secondary actions.
- Consistent spacing and radius within a module, on the Soft UI scales.
- Loading, empty, error, and success states are designed.
- Avoid generic AI-looking gradients or interchangeable layouts unless the existing design system already uses them
  (the AI visual language in `vendix-ai-style` is the one sanctioned exception).
- Checked with at least one non-default brand color and in dark mode.

## Skill Routing

- Angular component structure: `vendix-frontend`.
- Zoneless/signals/CVA: `vendix-zoneless-signals`.
- Reactive forms: `vendix-angular-forms`.
- Icons: `vendix-frontend-icons`.
- Modals: `vendix-frontend-modal`.
- Theme/tokens: `vendix-frontend-theme`.
- Standard admin modules: `vendix-frontend-standard-module`.
- Tables/cards: `vendix-frontend-data-display`.
- Stats/KPIs: `vendix-frontend-stats-cards`.
- Sticky headers: `vendix-frontend-sticky-header`.
- Sidebar/module visibility: `vendix-panel-ui`.
- Guided tours: `vendix-tour`.
- App/domain context: `vendix-core`.

## Related Skills

- `vendix-frontend`
- `vendix-frontend-theme`
- `vendix-frontend-data-display`
- `vendix-zoneless-signals`
