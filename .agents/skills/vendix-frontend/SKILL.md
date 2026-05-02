---
name: vendix-frontend
description: >
  Frontend web overview for Vendix Angular 20 app and routing to specialized frontend skills.
  Trigger: When editing files in apps/frontend, deciding which frontend skill applies, or understanding frontend web architecture.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Editing or creating frontend web code"
    - "Understanding frontend web architecture"
---

# Vendix Frontend

## Purpose

Use this skill as a frontend web index. Detailed implementation rules live in specialized frontend skills. Vendix frontend web is Angular 20 with Zoneless + Signals; old examples using `OnInit` state holders, constructor DI, `BehaviorSubject` UI state, or `async` pipe as the default should not be copied into new code.

## Current App Boundary

- Web frontend: `apps/frontend` (Angular 20).
- Native/mobile app: `apps/mobile` (Expo/React Native) and not governed by Angular frontend skills.
- Mobile in Angular skills means responsive web viewport, not native mobile.

## Always Load For Frontend Web

| Task | Skill |
| --- | --- |
| Any Angular component/template work | `vendix-zoneless-signals` |
| Component structure/shared components | `vendix-frontend-component` |
| Admin list screens | `vendix-frontend-standard-module` |
| Tables/cards/responsive list display | `vendix-frontend-data-display` |
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

## Repository Pointers

- App routes start empty in `apps/frontend/src/app/app.routes.ts`; route setup is managed dynamically.
- Public routes live under `apps/frontend/src/app/routes/public`.
- Private routes live under `apps/frontend/src/app/routes/private`.
- Admin modules live under `apps/frontend/src/app/private/modules`.
- Shared UI components live under `apps/frontend/src/app/shared/components`.

## Related Skills

- `vendix-zoneless-signals` - Mandatory Angular 20 runtime rules
- `vendix-frontend-routing` - Route/lazy-loading patterns
- `vendix-frontend-component` - Component structure and shared components
- `vendix-ui-ux` - Responsive web UX rules
