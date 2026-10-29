---
name: vendix-frontend-theme
description: >
  Frontend theme and branding patterns: ThemeService, CSS variables, tenant branding,
  user theme presets, RGB variables, browser guards, and deprecated theme APIs. Trigger:
  When styling/theming frontend UI or working with branding configuration.
license: MIT
metadata:
  author: rzyfront
  version: "2.2"
  scope: [root]
  auto_invoke: "Styling and Theming"
---

# Vendix Frontend Theme

## Source of Truth

- `apps/frontend/src/app/core/services/theme.service.ts`
- `apps/frontend/src/app/core/models/tenant-config.interface.ts`
- Global styles in `apps/frontend/src/styles.scss`

## Current Model

`ThemeService` applies tenant branding (`applyBranding`, from `AppConfigService` and `auth.effects.ts` `applyBrandingFromStoreSettings$`) plus user preferences: mode `light | dark | system` (`applyMode`, `isDarkMode()`) and presets `default | aura | monocromo | glass` (`applyStylePreset`). Persisted prefs (`config.preferences.theme_mode` / `theme`) go through `applyThemePreferences(mode, preset)`; previews use `snapshotTheme()` / `restoreTheme()` / `clearThemeSnapshot()`.

The service generates CSS variables and RGB variants for dynamic alpha usage. It includes browser/SSR guards; do not access `document` directly from random services/components.

## CSS Variables

Use variables instead of hardcoded colors:

- `--color-primary`, `--color-secondary`, `--color-accent`
- `--color-background`, `--color-surface`
- `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`
- RGB variants for primary/secondary/accent/background/surface

`--color-border` exists globally in styles, but backend branding transform does not currently map `border_color`.

## Branding Transform

Use `ThemeService.transformBrandingFromApi()` for API snake_case to frontend branding shape. Do not duplicate transform logic in components.

Deprecated: `applyTheme()` and `transformThemeFromApi()`; do not use in new code.

Dark mode sets `html[data-theme="dark"]` and presets set `[data-theme-preset]`; token overrides live in `styles.scss`. Components must use the variables (not hardcoded white/black or `dark:` utilities) so modes and presets apply.

## Component Rules

- **Never hardcoded CSS.** No hex, `rgb()/rgba()`, raw `px` or Tailwind arbitrary values
  (`bg-[#…]`, `text-[11px]`, `rounded-[…]`, `shadow-[…]`). Use Tailwind token classes or
  `var(--…)`. If a value has no token, add the token to `styles.scss` / `tailwind.config.js` first.
- **Multibrand.** The primary color is the tenant's. Brand accents use `primary` with alpha
  (`bg-primary/10`, `border-primary/25`, SCSS `rgba(var(--color-primary-rgb), .1)`), never `green-*`,
  `emerald-*` or the default green literal. Surfaces use `bg-surface` / `var(--color-surface)`, never
  white.
- States use semantic tokens: `success`, `warning`, `error` (with alpha). `info` has no RGB channel in
  Tailwind (`bg-info/10` emits nothing): use `bg-info-light`. Don't use fixed palettes (`rose-*`,
  `red-*`, `amber-*`) for meaning: they ignore dark mode.
- Keep tenant branding and user theme overlay behavior centralized in `ThemeService`.
- Do not add one-off theme mutation logic to feature components.
- Visual recipes built on these tokens (Soft UI): `vendix-ui-ux` → `references/soft-ui.md`.

## Token Gotchas

| Need | Use | Trap |
| --- | --- | --- |
| Control radius 12px | `rounded-xl` / `var(--radius-lg)` | `rounded-lg` is 14px; `--radius-md` is 8px but `rounded-md` is 10px |
| Card radius 16px | `rounded-2xl` / `var(--radius-xl)` | — |
| Icon-button radius 10px | `rounded-md` | no SCSS token yet: add one, don't write `10px` |
| Subtle shadow | `shadow-xs` | `shadow-2xs` is Tailwind v4: emits nothing here |
| Tinted brand bg | `bg-primary/10` | `--color-primary-light` is a fixed green rgba, not the tenant color |
| Neutral border | `border-border` | `border` alone falls back to the preflight gray |
| Default transition | `transition` / `transition-colors` (160ms) | custom `.15s`/`.2s` |

## Related Skills

- `vendix-ui-ux`
- `vendix-frontend`
- `vendix-core`
