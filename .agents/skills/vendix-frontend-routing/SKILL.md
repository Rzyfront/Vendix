---
name: vendix-frontend-routing
description: >
  Angular frontend web routing patterns, dynamic app routes, public/private route files, guards, and lazy loading.
  Trigger: Managing Routes, adding frontend routes, lazy-loading modules/components, or editing public/private route files.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Managing Routes"
    - "Adding frontend routes"
    - "Creating lazy-loaded frontend routes"
---

# Vendix Frontend Routing

## Purpose

Use this skill for Angular web routing in `apps/frontend`. It replaces the old separate lazy-routing skill; all route targets should be lazy-loaded unless there is a verified reason not to.

## Current Routing Reality

- `apps/frontend/src/app/app.routes.ts` exports an empty route array.
- Runtime route setup is handled dynamically by app/domain configuration.
- Public route files live in `apps/frontend/src/app/routes/public`.
- Private route files live in `apps/frontend/src/app/routes/private`.
- Many feature areas also expose `*.routes.ts` files under `private/modules/**`.

Key route files:

- `routes/private/super_admin.routes.ts`
- `routes/private/org_admin.routes.ts`
- `routes/private/store_admin.routes.ts`
- `routes/private/ecommerce.routes.ts`
- `routes/public/store_ecommerce.public.routes.ts`
- `routes/public/vendix_landing.public.routes.ts`
- `routes/public/org_landing.public.routes.ts`
- `routes/public/store_landing.public.routes.ts`

## Core Rules

- Use `loadComponent` for standalone components.
- Use `loadChildren` for route groups exported from `*.routes.ts`.
- Do not statically import routed page components into route files.
- Verify the actual parent route file is active before adding a child route.
- Public ecommerce/landing routes should not require staff/admin auth unless the page explicitly needs it.
- Private admin route roots use `AuthGuard`; backend still owns real authorization.
- Use route `data` for presentation metadata or default filters, not security decisions.

## Patterns

```typescript
{
  path: 'products',
  loadComponent: () =>
    import('../../private/modules/store/products/products.component').then(
      (c) => c.ProductsComponent,
    ),
}
```

```typescript
{
  path: 'accounting',
  loadChildren: () =>
    import('../../private/modules/store/accounting/accounting.routes').then(
      (m) => m.accountingRoutes,
    ),
}
```

## Adding A Route

1. Identify the active route tree: public, private app shell, or feature child routes.
2. Add a lazy `loadComponent` or `loadChildren` route.
3. Add guards only at the correct boundary.
4. Add sidebar/menu metadata separately through layout/menu files and `vendix-panel-ui` if this is an admin module.
5. Verify the path does not conflict with existing public aliases such as localized ecommerce routes.

## Related Skills

- `vendix-app-architecture` - AppType/domain routing concepts
- `vendix-panel-ui` - Sidebar visibility for private modules
- `vendix-zoneless-signals` - Component runtime rules
- `vendix-frontend-module` - Module file structure
