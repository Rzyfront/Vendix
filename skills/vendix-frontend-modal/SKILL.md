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

## Related Skills

- `vendix-zoneless-signals`
- `vendix-frontend-component`
- `vendix-angular-forms`
