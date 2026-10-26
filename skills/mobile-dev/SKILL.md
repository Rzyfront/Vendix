---
name: mobile-dev
description: >
  Mobile app development rules for Vendix Expo/React Native project.
  Trigger: When editing, creating, or modifying any file under apps/mobile, or when developing mobile-specific features.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Mobile Dev

`apps/mobile` (`@vendix/mobile`, Expo SDK 54, React Native 0.81) is touched only when the task names
it (AGENTS.md). Layout: `app/` (routes), `src/core` (api, auth, guards, store…), `src/features/<area>`,
`src/shared` (components, theme, types…).

## Rules

1. **Edit only inside `apps/mobile/`** (src, app, assets, its `package.json`, `tsconfig.json`,
   config files). Everything else — `apps/backend`, `apps/frontend`, `libs/*`, root files — is
   read-only reference (UI patterns, DTOs, Prisma models, shared enums). A needed change outside is a
   separate cross-project request.
2. **Dependencies** go only in `apps/mobile/package.json`: `npm install <pkg> -w apps/mobile` from the
   root (updates the root lock). Never install at root, never add to backend/frontend for mobile's
   sake. `apps/mobile/package-lock.json` is an isolated lock regenerated from the root resolutions
   (Dependabot scans it); do not hand-edit it.
3. **No cross-app runtime imports.** Read the backend DTO/endpoint, then write an equivalent interface
   inside mobile (e.g. `apps/mobile/src/features/<area>/` or `src/shared/types/`). Never
   `import … from '../../../backend/…'` or from `libs/` source.
4. **API consumption:** mobile calls the same backend API as the web; services in mobile adapt request/
   response shapes. Do not copy backend validation or business logic.

Scripts: `npm run mobile:start | mobile:ios | mobile:android | mobile:web` (root). CI (`ci.yml` job
`mobile`) runs `tsc --noEmit` and `expo export`; do not run them locally unless asked (`buildcheck-dev`).

## Related Skills

- `mobile-parity-audit` — parity of mobile features against the web
- `vendix-monorepo-workspaces` — dependency placement
