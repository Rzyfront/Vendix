---
name: vendix-frontend-theme
description: >
  Frontend theme and branding patterns: ThemeService, CSS variables, tenant branding,
  user theme presets, RGB variables, browser guards, and deprecated theme APIs. Trigger:
  When styling/theming frontend UI or working with branding configuration.
license: MIT
metadata:
  author: rzyfront
  version: "2.1"
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

- Use `var(--color-*)` with sensible fallbacks for reusable UI.
- Use RGB variables when alpha is needed instead of hardcoded rgba colors.
- Keep tenant branding and user theme overlay behavior centralized in `ThemeService`.
- Do not add one-off theme mutation logic to feature components.

## Related Skills

- `vendix-ui-ux`
- `vendix-frontend`
- `vendix-core`
