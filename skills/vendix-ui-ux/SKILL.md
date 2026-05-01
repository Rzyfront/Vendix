---
name: vendix-ui-ux
description: >
  Mobile-first UI/UX design philosophy, accessibility standards, visual quality checklist,
  and skill routing for Vendix frontend work. Trigger: When designing UI screens,
  implementing mobile-first layouts, checking accessibility, or creating landing pages.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "Designing UI screens, mobile-first layouts, accessibility review, landing pages, UX patterns"
---

# Vendix UI/UX

## Purpose

This is the broad design checklist. For implementation details, use the specialized frontend skills listed below.

## Core Standards

- Mobile-first base styles; add larger-screen behavior with `min-width` media queries.
- Semantic HTML: actions use `button`, navigation uses `a`/router links.
- Accessible touch targets: at least 44px where practical.
- Visible focus states; never remove outlines without replacement.
- Form fields need labels, not placeholders only.
- Use theme tokens (`var(--color-*)`) instead of hardcoded colors.
- Animate `transform` and `opacity`; avoid layout-property animations.
- Respect `prefers-reduced-motion` for substantial motion.

## App Context

| App | Priority |
| --- | --- |
| `STORE_ECOMMERCE` | Mobile conversion, speed, trust |
| `STORE_ADMIN` | Efficient admin workflows across mobile/desktop |
| `STORE_POS` | Touch-first speed and low friction |
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
- Consistent spacing and radius within a module.
- Loading, empty, error, and success states are designed.
- Avoid generic AI-looking gradients or interchangeable layouts unless the existing design system already uses them.

## Skill Routing

- Angular component structure: `vendix-frontend-component`.
- Zoneless/signals/CVA: `vendix-zoneless-signals`.
- Reactive forms: `vendix-angular-forms`.
- Icons: `vendix-frontend-icons`.
- Modals: `vendix-frontend-modal`.
- Theme/tokens: `vendix-frontend-theme`.
- Standard admin modules: `vendix-frontend-standard-module`.
- Tables/cards: `vendix-frontend-data-display`.
- Stats/KPIs: `vendix-frontend-stats-cards`.
- Sticky headers: `vendix-frontend-sticky-header`.
- App/domain context: `vendix-app-architecture`.

## Related Skills

- `vendix-frontend`
- `vendix-frontend-theme`
- `vendix-frontend-data-display`
- `vendix-zoneless-signals`
