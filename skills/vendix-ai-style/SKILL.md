---
name: vendix-ai-style
description: >
  Vendix AI visual language in apps/frontend: --vx-ai-* tokens, vx-ai-* utility classes and
  <app-button variant="ai">. Trigger: styling AI buttons, badges, sections, gradient "IA" text, or AI
  loading/analyzing states.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke:
    - "Styling AI buttons, badges, sections or loading states"
    - "Adding an AI scanning, analyzing or generating animation in the frontend"
    - "Highlighting the IA syllable or an AI feature name with gradient text"
---

# Vendix AI Style

## Purpose

Governs how AI features LOOK in `apps/frontend` (Angular web). One global
stylesheet owns the AI palette, glow, shimmer and every AI animation so that
"FacturIA", the RUT scanner, the product image enhancer and the ad wizard read
as the same product. It does not govern AI behavior (see `vendix-ai-engine`,
`vendix-ai-queue`) nor general theming (see `vendix-frontend-theme`).

## Source of Truth

- `apps/frontend/src/styles/vendix-ai-style.scss` — tokens, classes, keyframes.
- Loaded at the END of `apps/frontend/src/styles.scss` with
  `@use 'sass:meta'` + `@include meta.load-css('styles/vendix-ai-style')`.
- `apps/frontend/src/app/shared/components/button/button.component.ts` —
  `variant="ai"` maps to `vx-ai-button`.
- Reference consumers: `rut-scanner-modal.component.ts` (full stage),
  `product-image-ai-enhance-modal.component.ts` and
  `anuncio-create-wizard-page.component.ts` (holo layers, sparkles, orbit,
  skeleton, dot/soft pulse).

## Core Rules

- Use `vx-ai-*` classes and `var(--vx-ai-*)` tokens. Never hardcode an "AI"
  hex/rgba, gradient or glow in a component.
- Never redefine AI keyframes (`ai-sparkle-twinkle`, `ai-orbit-spin`, ...) in a
  component `styles:` block. Keyframes live once, prefixed `vx-ai-`.
- The rules are global (no `_ngcontent`), so they work inside any emulated
  component. Do not wrap them in `::ng-deep`.
- Identity classes (`vx-ai-surface`, `vx-ai-button`, `vx-ai-badge`,
  `vx-ai-text`, `vx-ai-border`) set color/background/shadow/border only. Put
  padding, radius and size with Tailwind next to them.
- The stylesheet sits AFTER Tailwind utilities: a Tailwind `bg-*`/`text-*` on
  the same element loses on the properties a `vx-ai-*` class sets. Do not fight
  it with `!important`; pick the right `vx-ai-*` class or a token override.
- Every animation stops under `prefers-reduced-motion: reduce` (already in the
  file). New AI animations must be added to that block.
- Prefer one AI accent per screen: a `variant="ai"` CTA plus at most a badge or
  gradient word. AI styling marks AI actions; it is not decoration.

## Catalog

Tokens (`--vx-ai-c1/c2/c3`, accents, gradients, glows, shimmer, durations, halo/scan sizes), classes (`vx-ai-surface`, `vx-ai-button`, `vx-ai-badge(--soft)`, `vx-ai-border`, `vx-ai-text`, `vx-ai-shimmer`, `vx-ai-skeleton-line`, `vx-ai-icon`, `vx-ai-soft-pulse`, `vx-ai-dot-pulse`, `vx-ai-orbit`, `vx-ai-holo-*`, `vx-ai-sparkle`, `vx-ai-stage`, `vx-ai-result-stage`) and HTML examples: `references/catalog.md` (leer bajo demanda). All tokens derive from `--color-primary/info/success`, so they follow tenant branding and dark mode; override a token locally (`style="--vx-ai-halo-size: 320px"`) instead of copying a rule.

## Dark Mode

Handled in the stylesheet: gradient stops darken further (white text stays
readable over the light dark-mode primary), `vx-ai-text` switches to the lighter
primary/info pair, glows gain alpha. Do not add `dark:` utilities for AI colors.

## Anti-patterns

- `background: linear-gradient(#7c3aed, #2563eb)` or any AI color literal in a component.
- Copying `@keyframes ai-*` / `.ai-sparkle` blocks into a new component.
- `customClasses="bg-gradient-to-r from-… to-…"` on `app-button` instead of `variant="ai"`.
- Animations without a reduced-motion exit.
- AI styling on non-AI actions, or several competing AI accents in one view.

## Legacy Notes

`product-image-ai-enhance-modal` and `anuncio-create-wizard-page` still keep
LOCAL `ai-result-stage*` rules because they differ from the global version
(anuncio: 320 px halo, box-shadow in icon-breathe, 64 px error icon, no breathe
on generating; product: a Tailwind `bg-gray-50` that the glass preset overrides
with higher specificity than the global class). Migrate them only with a visual
check; do not copy them as a pattern.

## Related Skills

- `vendix-frontend-theme` — base `--color-*` tokens the AI tokens derive from
- `vendix-ui-ux` — reduced motion, focus states, contrast
- `vendix-frontend` — reuse `app-button` (`variant="ai"`)
- `vendix-zoneless-signals` — component rules for AI UIs
