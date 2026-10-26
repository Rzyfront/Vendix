---
name: vendix-frontend
description: >
  Angular 20 frontend web for Vendix: components, feature modules, domain/app config,
  HTTP caching, routing to frontend skills. Trigger: editing apps/frontend, creating
  components or modules, frontend domains, caching HTTP/dashboard data.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke:
    - "Editing or creating frontend web code"
    - "Understanding frontend web architecture"
    - "Creating Angular components"
    - "Creating Frontend Modules"
    - "Working on frontend domains"
    - "Caching frontend HTTP/dashboard/report data"
---

# Vendix Frontend

## Purpose

Frontend web index plus component, module, domain-config, and cache patterns. Other detailed rules live in specialized frontend skills. Vendix frontend web is Angular 20 with Zoneless + Signals; old examples using `OnInit` state holders, constructor DI, `BehaviorSubject` UI state, or `async` pipe as the default should not be copied into new code.

## Current App Boundary

- Web frontend: `apps/frontend` (Angular 20).
- Native/mobile app: `apps/mobile` (Expo/React Native) and not governed by Angular frontend skills.
- Mobile in Angular skills means responsive web viewport, not native mobile.

## Always Load For Frontend Web

| Task | Skill |
| --- | --- |
| Any Angular component/template work | `vendix-zoneless-signals` |
| Component/module structure, shared components, domain config, caching | this skill |
| Admin list screens | `vendix-frontend-standard-module` |
| Tables/cards/responsive list display | `vendix-frontend-data-display` |
| Modals | `vendix-frontend-modal` |
| Routing | `vendix-frontend-routing` |
| NgRx/facades/signals state | `vendix-frontend-state` |
| Forms | `vendix-angular-forms` |
| Theme/branding tokens | `vendix-frontend-theme` |
| Mobile-first responsive UX | `vendix-ui-ux` |

## Core Rules

- Use `inject()` over constructor DI in new Angular code.
- Use `input()`, `output()`, `model()`, `signal()`, and `computed()` for component state and bindings.
- Use `@if`, `@for`, and `@defer` instead of adding new `*ngIf`/`*ngFor` patterns.
- Keep route targets lazy-loaded with `loadComponent` or `loadChildren`.
- Prefer existing shared components and READMEs before creating new UI primitives.
- Do not use frontend visibility (`panel_ui`) as backend authorization.

## Components

**Core rule:** reuse existing shared components before creating new ones. Check `apps/frontend/src/app/shared/components/index.ts` first — buttons, inputs, tables, modals, stats, responsive-data-view, date-range picker, paywall/modal components, diff viewers, pricing cards, and other reusable primitives.

Current reality — the repo mixes:

- shared components under `shared/components/`
- module-local components under `components/`
- some components in their own folders
- many legitimate loose `*.component.ts` files in a module directory

Do not enforce a false "every component must always live in its own folder with a README" rule on top of the existing codebase.

- Frontend code must follow `vendix-zoneless-signals`.
- Keep components standalone when that matches the surrounding module pattern.
- Match the nearest established pattern in the touched module instead of forcing a repo-wide folder migration.

## Feature Modules

Frontend feature modules commonly include some or all of: root feature component, `pages/`, `components/`, `services/`, `interfaces/`, `facades/` or state files when needed, and `*.routes.ts`. Some roots use inline templates/styles, some use separate html/scss files, and routes often lazy-load pages/components with `loadComponent()`.

- Match the established shape of the target module instead of forcing a single rigid skeleton.
- Do not assume every child component lives in its own folder.
- Use route files where the surrounding domain already does so.
- Prefer page components for larger flows and modal/detail/list components under `components/` when local to the module.
- Keep interfaces/services close to the module unless they are truly shared.

## Domain / App Config

Source of truth:

- `apps/frontend/src/app/core/services/app-config.service.ts`
- `apps/frontend/src/app/core/models/domain-config.interface.ts`
- `apps/frontend/src/app/core/models/environment.enum.ts`
- Route files under `apps/frontend/src/app/routes/`

`AppConfigService` is async and builds an `AppConfig` object through `setupConfig()` and `detectDomain()`. It does not expose the old `BehaviorSubject domain_config$$` pattern documented in legacy guidance. It currently:

- resolves the domain through `${environment.apiUrl}/public/domains/resolve/${hostname}`
- decides effective environment from domain config plus cached authenticated user environment
- builds public/private routes dynamically
- transforms branding through `ThemeService`
- caches app config and user environment in localStorage

`DomainConfig` includes fields such as `environment`, `domainType`, `organization_slug`, `store_slug`, `organization_id`, `store_id`, `store_logo_url`, `isVendixDomain`, `isMainVendixDomain`, and `customConfig` (can include `branding` and `currency`).

- For new domain/app behavior, update `AppConfigService` and the route maps rather than creating duplicate domain-config services.
- Treat app environment as the primary frontend router switch (AppType table in `vendix-core`).
- Keep branding resolution centralized in `ThemeService`.
- Preserve SSR/browser guards already present in `detectDomain()` and theme setup.

## HTTP Cache

Representative patterns:

- `.../super-admin/dashboard/services/super-admin-dashboard.service.ts`
- `.../organization/dashboard/services/organization-dashboard.service.ts`
- `.../store/reports/services/reports-data.service.ts`

Vendix does not use one single cache shape. Current patterns: service instance fields with TTL timestamps; module-level `Map` caches keyed by params/entity ids; helpers like `withCache(key, factory)`; `shareReplay({ bufferSize: 1, refCount: true })` and also `refCount: false`. Do not document a false rule that Angular service instances are always recreated on navigation or that all caches must be static globals.

- Pick cache shape based on the endpoint usage pattern, not ideology.
- Use stable cache keys when params/date ranges/entity ids change the result.
- Invalidate cache after writes that make the cached view stale.
- Avoid caching obviously real-time or rapidly changing streams unless the feature explicitly accepts staleness.
- Use short TTLs for dashboards/stats unless there is a stronger product reason.

## Common Pitfalls

### Unquoted backticks inside `template:` / `styles:` literals close the string

Angular component files often put HTML and CSS inside TypeScript template literals:

```ts
@Component({
  template: `
    <div class="...">
      <!-- comment mentioning a selector, e.g. app-sticky-header -->
    </div>
  `,
  styles: [`
    .x { color: var(--c); }
  `],
})
```

A raw backtick (`` ` ``) anywhere inside that literal — including inside a `<!-- comment -->` or `/* comment */` — closes the template literal early. Everything after that backtick is then parsed as TypeScript. Because the next character is usually ordinary prose, the resulting errors look unrelated to the comment and point far away from the actual mistake:

- `TS2322: Type 'boolean' is not assignable to type 'string'` near the opening backtick on the `template:` / `styles:` line.
- `TS2365: Operator '<' cannot be applied to types 'string' and 'number'` on the same line.
- `TS2304: Cannot find name 'app'` / `'sticky'` / `'header'` on the line of the comment that contains the offending backtick.

The misleading line numbers cause confusion in shared dev environments. The mistake has been misattributed to file-corruption bugs (VirtioFS torn writes, `colima` mount drift) and to other agents' work; `colima restart` does NOT cure it.

**Cheap probe before running the full typecheck** (the full buildcheck can take minutes when the dev tree is shared):

```bash
npx tsc --noEmit --skipLibCheck \
  --target es2022 --moduleResolution bundler --module esnext \
  apps/frontend/src/app/path/to/changed.component.ts
```

If the error mentions identifiers that only exist inside a comment, that is the smoking gun.

**Rule:** inside a comment that lives inside a `template:` or `styles:` literal, either escape backticks as `` \` `` (the same component may already use this in its `styles:` block, lines 298-299 of `header.component.ts`) or avoid them and use single quotes instead.

## Repository Pointers

- App routes start empty in `apps/frontend/src/app/app.routes.ts`; route setup is managed dynamically.
- Public routes live under `apps/frontend/src/app/routes/public`.
- Private routes live under `apps/frontend/src/app/routes/private`.
- Admin modules live under `apps/frontend/src/app/private/modules`.
- Shared UI components live under `apps/frontend/src/app/shared/components`.

## Related Skills

- `vendix-zoneless-signals` - Mandatory Angular 20 runtime rules
- `vendix-frontend-routing` - Route/lazy-loading patterns
- `vendix-frontend-state` - NgRx/facades/signals state
- `vendix-frontend-modal` - Modals
- `vendix-frontend-data-display` - Tables/cards
- `vendix-frontend-theme` - Branding/ThemeService
- `vendix-core` - App environments (AppType) and domain resolution
- `vendix-ui-ux` - Responsive web UX rules
