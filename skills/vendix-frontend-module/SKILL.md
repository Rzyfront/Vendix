---
name: vendix-frontend-module
description: >
  Angular module/feature structure patterns for Vendix: pages, services, interfaces,
  routes, standalone roots, and module-local components aligned to current repo reality.
  Trigger: When creating Frontend Modules.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "Creating Frontend Modules"
---

# Vendix Frontend Module

## Current Reality

Frontend feature modules commonly include some or all of these:

- root feature component
- `pages/`
- `components/`
- `services/`
- `interfaces/`
- `facades/` or state files when needed
- `*.routes.ts`

Some roots use inline templates/styles, some use separate html/scss files, and routes often lazy-load pages/components with `loadComponent()`.

## Rules

- Match the established shape of the target module instead of forcing a single rigid skeleton.
- Do not assume every child component lives in its own folder.
- Use route files where the surrounding domain already does so.
- Prefer page components for larger flows and modal/detail/list components under `components/` when local to the module.
- Keep interfaces/services close to the module unless they are truly shared.

## Related Skills

- `vendix-frontend-component`
- `vendix-frontend-routing`
- `vendix-zoneless-signals`
