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

The misleading line numbers cause confusion in shared dev environments. The mistake has been misattributed to file-corruption bugs (VirtioFS torn writes, `colima` mount drift) and to other agents' work; `colima restart` does NOT cure it. A grep across `skills/` and `.claude/skills/` confirms this failure mode is not currently documented anywhere else.

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
- `vendix-frontend-component` - Component structure and shared components
- `vendix-ui-ux` - Responsive web UX rules
