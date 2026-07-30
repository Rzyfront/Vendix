---
name: vendix-frontend-modal
description: >
  Modal implementation patterns for Vendix frontend: app-modal API, model-based visibility,
  slots, outputs, zoneless-safe close/open behavior, and modal wrapper usage in feature flows.
  Trigger: When creating or modifying modals in frontend.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "Creating or modifying modals in frontend"
---

# Vendix Frontend Modal

## Source of Truth

- `apps/frontend/src/app/shared/components/modal/modal.component.ts`
- `apps/frontend/src/app/shared/components/modal/README.md`

## Current `app-modal` API

`app-modal` is a standalone shared component using signal APIs.

Inputs:

- `isOpen` via `model<boolean>(false)`
- `title`
- `subtitle`
- `size`: `sm | md | lg | xl-mid | xl`
- `centered`
- `closeOnBackdrop`
- `closeOnEscape`
- `showCloseButton`
- `overlayCloseButton`
- `customClasses`

Outputs:

- `opened`
- `closed`
- `cancel`

Slots/content areas:

- default body content
- `[slot=header]`
- `[slot=header-end]`
- `[slot=footer]`

## Rules

- Always follow `vendix-zoneless-signals` patterns when wrapping modals.
- Use `[(isOpen)]` with a signal/model in the parent or wrapper component.
- Prefer shared system components inside the modal body, but this is a preference, not a false hard rule.
- Use the footer slot for action buttons.
- Listen to `cancel` when the wrapper needs cleanup on close.

## Behavior Notes

- `opened` and `closed` are emitted from an `effect()` observing `isOpen()` transitions.
- `close()` sets `isOpen(false)` and emits `cancel`.
- Escape closing is wired through a browser-only keydown listener.
- Current backdrop-close handling is attached to the wrapper `dblclick` path plus outside-container detection; document current behavior, do not assume a different click contract without checking the component.

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
a parallel output. This pattern was found in **20 of 64** wrappers during
QUI-554; fix them opportunistically when you touch one.

Related trap: an `output()` that is **declared and never emitted** looks like
the parent covers a concern it never receives. `onUserUpdated` did exactly that
and hid QUI-554. Emit it or delete it.

## Mutations Inside A Modal

If the module owns NgRx state, the modal **dispatches an action** — it never
calls the HTTP service directly, and it never closes before the outcome
arrives. Full contract, spec + CI guard in `vendix-frontend-state`
§ "Mutations From Modals In NgRx-Backed Modules".

## Related Skills

- `vendix-zoneless-signals`
- `vendix-frontend-component`
- `vendix-angular-forms`
- `vendix-frontend-state`
