---
name: vendix-frontend-state
description: >
  Vendix frontend state patterns: NgRx facades with signal parallels, toSignal with
  initialValue, local signal state, takeUntilDestroyed, and pragmatic service-level cache/state.
  Trigger: When managing state.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "Managing State"
---

# Vendix Frontend State

## Source of Truth

- NgRx facades under `apps/frontend/src/app/core/store/**`
- Local services under feature modules
- `vendix-zoneless-signals` for critical Angular 20 rules

## Current Pattern

Vendix uses a hybrid state model:

- NgRx for global/shared state.
- Facades exposing observables and signal parallels via `toSignal(..., { initialValue })`.
- Local `signal()` state for component/service UI state.
- RxJS for HTTP/effects/async flows.

Legacy `BehaviorSubject + destroy$ + ngOnDestroy` service templates are not the primary pattern anymore.

## Rules

- Prefer facade signals for synchronous component reads.
- When bridging observables to signals, always provide `initialValue` where required.
- Use `takeUntilDestroyed()` in components/directives instead of ad-hoc `destroy$` subjects when subscribing imperatively.
- Keep HTTP side effects and store dispatches in facades/services, not templates.
- Use ToastService for user feedback, but do not couple every service method to a mandatory toast pattern.

## Related Skills

- `vendix-zoneless-signals`
- `vendix-frontend`
- `vendix-error-handling`
