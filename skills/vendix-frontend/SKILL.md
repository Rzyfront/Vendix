---
name: vendix-frontend
description: >
  Angular 20 frontend web for Vendix: components, feature modules, domain/app config,
  HTTP caching, routing to frontend skills. Trigger: editing apps/frontend, creating
  components or modules, frontend domains, caching HTTP/dashboard data.
license: MIT
metadata:
  author: rzyfront
  version: "1.2"
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

Index for `apps/frontend` (Angular 20 zoneless + signals) plus component, module, domain-config and cache patterns. `apps/mobile` is not governed by these skills; "mobile" here means responsive web viewport. Do not copy legacy patterns (`OnInit` state holders, constructor DI, `BehaviorSubject` UI state, `async` pipe by default).

## Load with frontend work

| Task | Skill |
| --- | --- |
| Any component/template | `vendix-zoneless-signals` (mandatory) |
| Admin list screens | `vendix-frontend-standard-module` |
| Tables/cards | `vendix-frontend-data-display` |
| Modals | `vendix-frontend-modal` |
| Routing | `vendix-frontend-routing` |
| NgRx/facades/signals state | `vendix-frontend-state` |
| Forms | `vendix-angular-forms` |
| Theme/branding | `vendix-frontend-theme` |
| Responsive UX | `vendix-ui-ux` |
| Sidebar/module visibility | `vendix-panel-ui` |

## Core rules

- `inject()`, `input()`/`output()`/`model()`, `signal()`/`computed()`; `@if`/`@for`/`@defer` in new code.
- Route targets lazy (`loadComponent` / `loadChildren`).
- Reuse shared components first: check `apps/frontend/src/app/shared/components/index.ts` and their READMEs before creating primitives.
- `panel_ui` visibility is never backend authorization.
- Match the nearest established pattern in the touched module (loose `*.component.ts`, `components/`, `pages/`, `services/`, `interfaces/`, `*.routes.ts`, inline or separate templates). Do not force folder migrations or a "one folder + README per component" rule.
- Keep interfaces/services local to the module unless truly shared.

## Domain / app config

Sources: `core/services/app-config.service.ts`, `core/models/domain-config.interface.ts`, `core/models/environment.enum.ts`, `routes/public`, `routes/private` (`app.routes.ts` starts empty; routes are built dynamically).

`AppConfigService.setupConfig()` → `detectDomain()` resolves `${environment.apiUrl}/public/domains/resolve/${hostname}`, picks the effective environment (domain + cached user environment), builds routes, applies branding via `ThemeService`, caches in localStorage. There is no `domain_config$$` BehaviorSubject.

- New domain/app behavior: extend `AppConfigService` and the route maps; never a duplicate domain-config service.
- App environment is the primary router switch (AppType table in `vendix-core`).
- Branding stays centralized in `ThemeService`; keep SSR/browser guards in `detectDomain()`.

## HTTP cache

No single cache shape. Examples: `private/modules/super-admin/dashboard/services/super-admin-dashboard.service.ts`, `private/modules/organization/dashboard/services/organization-dashboard.service.ts`, `private/modules/store/reports/services/reports-data.service.ts` (instance TTL fields, module-level `Map` keyed by params, `shareReplay({ bufferSize: 1, refCount })`).

- Stable keys including params/date ranges/entity ids; invalidate after writes; short TTL for dashboards; do not cache real-time streams unless staleness is accepted.

## Pitfall — backticks inside `template:` / `styles:`

A raw backtick inside a component `template:`/`styles:` literal (even in an HTML/CSS comment) closes the literal. Errors look unrelated (`TS2322` boolean→string, `TS2365` on `<`, `TS2304 Cannot find name 'app'` on the comment line); it is not file corruption and `colima restart` does not fix it. Escape as `` \` `` or use single quotes. If an error names identifiers that only exist inside a comment, that is the cause.

## Related

`vendix-zoneless-signals`, `vendix-frontend-routing`, `vendix-frontend-state`, `vendix-frontend-modal`, `vendix-frontend-data-display`, `vendix-frontend-theme`, `vendix-core`, `vendix-ui-ux`, `buildcheck-dev`.
