---
name: vendix-monorepo-workspaces
description: >
  Monorepo workspaces, dependency placement, Docker, and CI/CD patterns for Vendix.
  Trigger: When installing dependencies, modifying package.json, adding/removing workspaces, creating Dockerfiles, or configuring CI/CD.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
---

# Vendix Monorepo Workspaces

Root `package.json` declares workspaces `apps/*` and `libs/*` and orchestrates scripts. Architecture
ownership: `vendix-core`.

| Workspace | Path | Notes |
| --- | --- | --- |
| Backend | `apps/backend` | NestJS; `Dockerfile` (prod) + `Dockerfile.dev` |
| Frontend | `apps/frontend` | Angular; `Dockerfile` + `Dockerfile.dev` (dev runs natively) |
| Mobile | `apps/mobile` | `@vendix/mobile`, Expo; no Dockerfile; isolated `package-lock.json` (see `mobile-dev`) |
| Shared types | `libs/shared-types` | `@vendix/shared-types` |
| Print formats | `libs/print-formats` | Schemas only, not an npm package; `npm run sync:geometry` (also `prebuild`) copies `page-geometry.json` byte-for-byte into backend/frontend/mobile |

## Dependency rules

- The workspace that imports a package declares it: `npm install <pkg> -w apps/<app>`. Used by two
  apps → declare in both. Never rely on hoisting.
- Root holds orchestration scripts and shared dev tooling. Root runtime deps are reviewed exceptions;
  today there is one (`@shopify/react-native-skia`). Never add root production deps to make CI pass.
- Shared libs declare their own metadata, no hidden app dependencies.

## Commands

```bash
npm install                                  # all workspaces, from root
npm install <pkg> -w apps/backend|apps/frontend|apps/mobile
npm run dev:fe                               # frontend dev (native ng serve)
npm run mobile:start | mobile:ios | mobile:android | mobile:web
npm run docker:up | docker:rebuild | docker:down | docker:down-v
```

Backend dev runs in Docker; do not use `npm run dev` / `start:dev -w apps/backend` (they start the
backend on the host). No builds unless asked (`buildcheck-dev`).

## Docker

- Compose services: `db`, `redis`, `backend`, `nginx`, `docker-cleanup`; optional profiles
  `backend-worker` (`split`) and `frontend` (`docker-fe`, fallback only).
- Build contexts point at the workspace (`./apps/backend`). Exception: the `frontend` service uses the
  repo root as context so it can reach `apps/backend/src/common/money-kernel/` (QUI-832).
- Containers mount their workspace and isolate `/app/node_modules`.

## CI/CD

`ci.yml` runs `npm ci` at the root and then per-workspace jobs (path filters for backend, frontend,
mobile). Keep image builds scoped to the app workspace unless the Dockerfile requires repo context.

## Adding or removing a workspace

Add: place under `apps/` or `libs/`, own `package.json` with accurate deps, root scripts only if
useful, a skill if it introduces new patterns. Remove: drop root scripts and references to it, then
`npm install` from root to update the lock.
