---
name: vendix-frontend-component
description: >
  Angular component structure rules for Vendix: reuse shared components first, follow
  zoneless/signals patterns, and align component folder shape with real repo conventions
  instead of rigid outdated rules. Trigger: When creating Angular components.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "Creating Angular components"
---

# Vendix Frontend Component

## Core Rule

Reuse existing shared components before creating new ones. Check `apps/frontend/src/app/shared/components/index.ts` first.

## Current Reality

The repo mixes:

- shared components under `shared/components/`
- module-local components under `components/`
- some components in their own folders
- many legitimate loose `*.component.ts` files in a module directory

Do not enforce a false “every component must always live in its own folder with a README” rule on top of the existing codebase.

## Required Patterns

- Frontend code must follow `vendix-zoneless-signals`.
- Prefer `input()`, `output()`, `model()`, `signal()`, and `computed()` in new code.
- Keep components standalone when that matches the surrounding module pattern.
- Match the nearest established pattern in the touched module instead of forcing a repo-wide folder migration.

## Shared Component Check

Before creating a new component, inspect shared exports such as buttons, inputs, tables, modals, stats, responsive-data-view, date-range picker, paywall/modal components, diff viewers, pricing cards, and other reusable primitives exposed from `shared/components/index.ts`.

## Related Skills

- `vendix-zoneless-signals`
- `vendix-frontend-module`
- `vendix-frontend-modal`
- `vendix-frontend-data-display`
