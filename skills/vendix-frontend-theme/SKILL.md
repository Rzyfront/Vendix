---
name: vendix-frontend-theme
description: >
  Frontend theme and branding patterns: ThemeService, CSS variables, tenant branding,
  user theme presets, RGB variables, browser guards, and deprecated theme APIs. Trigger:
  When styling/theming frontend UI or working with branding configuration.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "Styling and Theming"
---

# Vendix Frontend Theme

## Source of Truth

- `apps/frontend/src/app/core/services/theme.service.ts`
- `apps/frontend/src/app/core/models/tenant-config.interface.ts`
- Global styles in `apps/frontend/src/styles.scss`

## Current Model

`ThemeService` applies tenant branding plus user theme presets. Current presets include `default`, `aura`, `monocromo`, and `glass`.

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

Deprecated APIs such as `applyTheme()` and `transformThemeFromApi()` should not be used in new code.

## Component Rules

- Use `var(--color-*)` with sensible fallbacks for reusable UI.
- Use RGB variables when alpha is needed instead of hardcoded rgba colors.
- Keep tenant branding and user theme overlay behavior centralized in `ThemeService`.
- Do not add one-off theme mutation logic to feature components.

## Related Skills

- `vendix-ui-ux`
- `vendix-frontend-component`
- `vendix-app-architecture`
