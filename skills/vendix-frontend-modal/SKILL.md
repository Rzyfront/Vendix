---
name: vendix-frontend-modal
description: >
  Modal implementation patterns for Vendix frontend: app-modal API, model-based visibility,
  slots, outputs, zoneless-safe close/open behavior, and modal wrapper usage in feature flows.
  Trigger: When creating or modifying modals in frontend.
license: MIT
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke: "Creating or modifying modals in frontend"
---

# Vendix Frontend Modal

Source: `apps/frontend/src/app/shared/components/modal/modal.component.ts` (+ `README.md`).

## `app-modal` API

- `isOpen`: `model<boolean>(false)` → use `[(isOpen)]`.
- Inputs: `title`, `subtitle`, `size` (`sm | md | lg | xl-mid | xl | xxl | full`, default `md`), `centered` (true), `closeOnBackdrop` (**false** by default, QUI-438), `closeOnEscape` (true), `showCloseButton` (true), `overlayCloseButton`, `customClasses`, `dialog` (true: role/aria, focus trap, focus restore, Escape), `canClose: () => boolean | Promise<boolean>` (block close, e.g. dirty form), `fullScreenOnMobile` (opt-in full-screen sheet below `md:`).
- Outputs: `opened`, `closed` (from an `effect()` on `isOpen()` transitions), `cancel` (emitted by `close()`).
- Slots: default body, `[slot=header]`, `[slot=header-end]`, `[slot=footer]` (action buttons).

## Rules

- Follow `vendix-zoneless-signals` in wrappers.
- `close()` respects `canClose()` (sync or async), then sets `isOpen(false)` and emits `cancel`; listen to `cancel` for wrapper cleanup.
- Backdrop close is a single `click` outside the container and only when `[closeOnBackdrop]="true"`. Do not opt in for forms.
- Keep `dialog` true except purely decorative modals.
- Prefer shared components inside the body (preference, not hard rule).

## Wrapper Pattern

- Wrapper components should own form state, submit state, and domain-specific cleanup.
- `app-modal` owns only generic modal chrome/visibility behavior.
- Keep create/edit flows on the same screen when that matches the surrounding module pattern; do not force route-based CRUD when the existing UX is modal-first.

## Never Duplicate The `model()` Channel

A wrapper's visibility is `isOpen = model<boolean>(false)`. That **already**
publishes the output `isOpenChange` — Angular generates it. Declaring
`isOpenChange = output<boolean>()` alongside it creates **two** outputs with one
name for one piece of state: the hand-written one shadows the implicit one, so
emitting it notifies the parent while leaving the wrapper's own `model`
untouched. `[(isOpen)]` in the parent then appears to work only because the
parent writes back into the child — the child's internal reads are stale.

```ts
// ✅ close from inside the wrapper
readonly isOpen = model<boolean>(false);
onCancel(): void { this.isOpen.set(false); }

// ❌ never
readonly isOpen = model<boolean>(false);
readonly isOpenChange = output<boolean>();   // duplicate channel
onCancel(): void { this.isOpenChange.emit(false); }  // model stays true
```

Same rule for the inner `app-modal`: forward its `(isOpenChange)` into the
wrapper's own model — `(isOpenChange)="isOpen.set($event)"` — instead of adding
a parallel output. Fix existing offenders opportunistically when you touch one.

An `output()` declared but never emitted hides missing behavior: emit it or delete it.

## Mutations Inside A Modal

If the module owns NgRx state, the modal **dispatches an action** — it never
calls the HTTP service directly, and it never closes before the outcome
arrives. Full contract, spec + CI guard in `vendix-frontend-state`
§ "Mutations From Modals In NgRx-Backed Modules".

## Related Skills

- `vendix-zoneless-signals`
- `vendix-frontend`
- `vendix-angular-forms`
- `vendix-frontend-state`
