---
name: vendix-zoneless-signals
description: >
  Angular 20 zoneless and signals patterns for Vendix frontend: app.config setup, signal
  inputs/outputs/models, toSignal in facades, CVA rules, audit script usage, and legacy
  patterns that must not be copied into new code.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  priority: critical
  auto_invoke:
    - "Editing or creating any Angular component under apps/frontend (Zoneless patterns apply)"
    - "Using input(), output(), model(), signal(), computed(), effect(), or toSignal()"
    - "Implementing ControlValueAccessor (CVA) in custom form components"
    - "Debugging stale templates, missing re-renders, or change detection issues"
    - "Reviewing or replacing NgZone, markForCheck, detectChanges, @Input, @Output, EventEmitter"
    - "Migrating legacy Angular patterns (BehaviorSubject, take(1).subscribe) to Signals"
    - "Auditing Zoneless compliance (zoneless-audit.sh) or enforcing CI grep rules"
    - "Working with @defer, @if, @for control flow blocks in templates"
    - "Using toSignal() in facades — validating initialValue presence"
    - "Fixing signal-used-without-invoking bugs (!this.flag vs !this.flag())"
---

# Vendix Zoneless Signals

## Source of Truth

- `apps/frontend/src/app/app.config.ts`
- `apps/frontend/scripts/zoneless-audit.sh`
- current facades/components under `apps/frontend/src/app/`

## Setup

Vendix frontend runs with `provideZonelessChangeDetection()` in `app.config.ts`.

NgRx runtime checks explicitly set `strictActionWithinNgZone: false`.

## New-Code Rules

- Prefer `input()`, `output()`, `model()`, `signal()`, `computed()`, and `effect()`.
- Prefer facade signals or `toSignal(..., { initialValue })` for synchronous reads.
- UI state read by templates must be signal-based, not plain mutable class fields.
- Custom CVAs must store template-observed `value` / `disabled` state in signals.
- Do not introduce `NgZone.run()`, `markForCheck()`, `detectChanges()`, or sync `take(1).subscribe()` patterns unless there is a documented and exceptional reason.

## Legacy Reality

The repo is largely migrated, but the canonical audit source is `zoneless-audit.sh`, not a naive “all grep counts must be zero” assumption. The audit script already includes documented exemptions and warning-only checks.

Do not copy remaining legacy patterns just because a few repo exceptions still exist.

## Audit Guidance

Use `apps/frontend/scripts/zoneless-audit.sh` as the first compliance check. It validates:

- `@Input/@Output` regressions
- `EventEmitter`
- `NgZone`
- `markForCheck` / `detectChanges`
- legacy structural directives
- `BehaviorSubject`
- `toSignal` without `initialValue` in facades
- unmanaged `subscribe()` usage
- `zone.js` outside allowed test contexts

Some checks are warnings, not hard failures. Follow the script’s logic rather than inventing stricter local grep rules.

## Common Bugs To Avoid

- signal used without invocation: `if (this.loading)` instead of `if (this.loading())`
- plain UI booleans/strings used in templates in zoneless components
- `toSignal()` in facades without `initialValue` when synchronous consumers exist
- outputs emitted only from imperative methods while the real source of truth is a `model()` signal

## Template Rules

- Use `@if`, `@for`, `@defer` in new templates.
- `async` pipe still works, but prefer signal access when synchronous reads or signal composition are clearer.

## Related Skills

- `vendix-frontend`
- `vendix-angular-forms`
- `vendix-frontend-component`
- `vendix-frontend-state`
