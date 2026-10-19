---
name: vendix-ai-style
description: >
  Vendix AI Style: the single visual language for anything the AI does in the
  web frontend — global `--vx-ai-*` tokens, `vx-ai-*` utility classes (surface,
  button, badge, animated border, gradient text, shimmer, skeleton, orbit,
  analysis stage, result stage, sparkles) and `<app-button variant="ai">`.
  Trigger: Styling AI buttons, badges, sections, gradient "IA" text, or AI
  loading/analyzing states in apps/frontend.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
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

## Tokens (`:root`, dark overrides in `[data-theme='dark']`)

| Token | Use |
| --- | --- |
| `--vx-ai-c1` | Gradient start: primary darkened (white text readable) |
| `--vx-ai-c2` | Gradient middle: info darkened |
| `--vx-ai-c3` | Third hue (success) for halos/borders only, never under text |
| `--vx-ai-accent` / `--vx-ai-accent-2` | Pure primary / info for glows, rings, scans, sparkles |
| `--vx-ai-on` | Text on AI gradients (`#fff`) |
| `--vx-ai-gradient` | Button/badge fill (200 % wide; shifts on hover) |
| `--vx-ai-gradient-text` | Gradient for `vx-ai-text` (lighter stops in dark) |
| `--vx-ai-gradient-border` | Animated border gradient |
| `--vx-ai-surface-bg` / `--vx-ai-surface-border` | Radial tint + border of AI sections |
| `--vx-ai-glow` / `--vx-ai-glow-strong` | Resting / hover glow |
| `--vx-ai-shimmer` / `--vx-ai-shimmer-tint` | White sweep (over gradients/images) / tinted sweep (over surfaces) |
| `--vx-ai-duration-fast` / `--vx-ai-duration` / `--vx-ai-duration-slow` | 1.6 s / 2.4 s / 6 s |
| `--vx-ai-border-width` | Animated border thickness (1.5 px) |
| `--vx-ai-scan-distance` | Vertical scanner travel (300 px stage, 280 px result stage) |
| `--vx-ai-halo-size` | Conic halo diameter (280 px) |

All tokens derive from `--color-primary`, `--color-info`, `--color-success`, so
they follow tenant branding and dark mode. Override a token locally (e.g.
`style="--vx-ai-halo-size: 320px"`) instead of copying a rule.

## Classes

| Class | What it does |
| --- | --- |
| `vx-ai-surface` | AI section/card: radial primary+info tint over `--color-surface`, tinted border |
| `vx-ai-button` | AI CTA: gradient + glow; hover shifts gradient, grows glow, shimmer sweep; focus ring; no glow when disabled |
| `vx-ai-badge` / `vx-ai-badge--soft` | Solid gradient "IA" pill / soft tinted pill |
| `vx-ai-border` | Animated gradient border via mask (element needs its own radius) |
| `vx-ai-text` | Gradient text (falls back to `--vx-ai-c1`) |
| `vx-ai-shimmer` | Wrapper with tinted shimmer overlay for loading content |
| `vx-ai-skeleton-line` | 10 px rounded skeleton line (width via Tailwind) |
| `vx-ai-icon` | 72 px glowing icon disc that breathes |
| `vx-ai-soft-pulse` | Soft pulse + drop-shadow glow for "thinking" icons |
| `vx-ai-dot-pulse` | 6 px pulsing dot ("writing…") |
| `vx-ai-orbit` (+ `__core`, `__ring`, `__ring--delayed`) | Compact orbit loader |
| `vx-ai-holo-grid` / `vx-ai-holo-aurora` | Holographic background layers |
| `vx-ai-sparkle` (+ `--a` … `--e`) | Five twinkling sparkles at fixed positions |
| `vx-ai-stage` `.is-analyzing` (+ `__icon`, `__caption`, `__halo`, `__scan`, `__shimmer`) | Full "AI is analyzing" scene (scanners) |
| `vx-ai-result-stage` `.is-generating` / `.is-error` (+ `__placeholder`, `__idle`, `__error-state`, `__icon`, `__error-icon`, `__caption`, `__error-title`, `__error-text`, `__halo`, `__scan`, `__shimmer`, `__prism`) | Canvas where a generated result appears |

## Examples

```html
<!-- AI section -->
<section class="vx-ai-surface rounded-2xl p-4">
  <span class="vx-ai-badge">IA</span>
  <h3 class="text-base font-semibold">Factur<span class="vx-ai-text">IA</span></h3>
</section>

<!-- AI CTA (preferred over a raw <button>) -->
<app-button variant="ai" (clicked)="scan()">
  <app-icon name="sparkles" [size]="16" slot="icon"></app-icon>
  Escanear con IA
</app-button>

<!-- Analyzing scene -->
<div class="vx-ai-stage is-analyzing relative overflow-hidden rounded-2xl border border-border min-h-[320px] flex flex-col items-center justify-center gap-4 p-6">
  <div class="vx-ai-holo-aurora"></div>
  <div class="vx-ai-holo-grid"></div>
  <div class="vx-ai-stage__halo"></div>
  <div class="vx-ai-stage__scan"></div>
  <div class="vx-ai-stage__shimmer"></div>
  <span class="vx-ai-sparkle vx-ai-sparkle--a"></span>
  <!-- … --b, --c, --d, --e -->
  <div class="vx-ai-stage__icon"><app-icon name="sparkles" [size]="32"></app-icon></div>
  <p class="vx-ai-stage__caption text-sm">Analizando con IA…</p>
</div>

<!-- Pending text -->
<div class="space-y-2">
  <div class="vx-ai-skeleton-line w-2/3"></div>
  <div class="vx-ai-skeleton-line w-full"></div>
</div>
```

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
- `vendix-frontend-component` — reuse `app-button` (`variant="ai"`)
- `vendix-zoneless-signals` — component rules for AI UIs
