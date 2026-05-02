---
name: vendix-monorepo-workspaces
description: >
  Monorepo workspaces, dependency placement, Docker, and CI/CD patterns for Vendix.
  Trigger: When installing dependencies, modifying package.json, adding/removing workspaces, creating Dockerfiles, or configuring CI/CD.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Installing dependencies"
    - "Modifying package.json"
    - "Creating Dockerfiles"
    - "Configuring CI/CD"
    - "Adding/removing workspaces"
---

# Vendix Monorepo Workspaces

## Purpose

Use this skill for npm workspaces, dependency placement, app package boundaries, Docker build contexts, and CI/CD commands. Architecture ownership belongs to `vendix-core`.

## Current Workspace Map

| Workspace | Path | Notes |
| --- | --- | --- |
| Backend | `apps/backend` | NestJS API with its own dependencies and Dockerfiles |
| Frontend web | `apps/frontend` | Angular app with its own dependencies and Dockerfiles |
| Mobile | `apps/mobile` | Expo/React Native app with its own dependencies |
| Shared types | `libs/shared-types` | Local package consumed by apps, e.g. `@vendix/shared-types` |

Root `package.json` orchestrates scripts and workspaces. Production/runtime dependencies should normally live in the workspace that imports them. Root dependencies should be treated as exceptions and reviewed before adding more; the current repo already has at least one root runtime exception, so do not assume `dependencies` is empty.

## Dependency Rules

- If code in one workspace imports a package, that workspace must declare the dependency.
- If frontend and backend both import the same package, install it in both workspaces.
- If mobile imports a package, install it in `apps/mobile`.
- Shared libraries should declare their own package metadata and avoid hidden app dependencies.
- Root should mainly contain orchestration scripts and shared dev tooling, unless an explicit repo-level exception is required and documented.
- Do not rely on hoisting as the reason a workspace can build.

## Commands

```bash
# Install all workspaces from root
npm install

# Install in a specific workspace
npm install <package> -w apps/frontend
npm install <package> -w apps/backend
npm install <package> -w apps/mobile

# Run workspace scripts
npm run start -w apps/frontend
npm run start:dev -w apps/backend
npm run start -w apps/mobile

# Root orchestration scripts
npm run dev
npm run mobile:start
npm run mobile:ios
npm run mobile:android
```

Do not run production build commands unless the human explicitly requests production verification; use `buildcheck-dev` for normal development verification.

## Docker Rules

- Docker build contexts for app containers should point at the workspace, not the repo root.
- Current dev containers use `apps/backend/Dockerfile.dev` and `apps/frontend/Dockerfile.dev`.
- Backend and frontend containers mount their workspace and isolate `/app/node_modules`.
- Mobile currently does not have a Dockerfile in this repo; treat mobile Dockerization as a knowledge gap unless added intentionally.

Current compose services include `db`, `redis`, `backend`, `frontend`, `nginx`, and `docker-cleanup`.

## Docker Commands

```bash
# Start development services
docker compose up -d

# Rebuild services after Dockerfile/package changes
docker compose up --build -d

# Stop services
docker compose down
```

Prefer the root docker scripts already present in `package.json` when useful: `docker:up`, `docker:rebuild`, `docker:down`, `docker:down-v`.

Use `buildcheck-dev` for log-based verification after development changes.

## CI/CD Rules

- Install dependencies from root with workspace-aware npm commands.
- Build or lint the specific workspace being validated.
- Keep Docker image builds scoped to the app workspace unless the Dockerfile explicitly requires repo context.
- Do not add root-level production dependencies to make CI pass; fix the workspace package instead.

## Adding Or Removing Workspaces

When adding a workspace:

1. Place it under `apps/` or `libs/` so root workspaces detect it.
2. Give it its own `package.json` with accurate dependencies.
3. Add root scripts only when cross-team orchestration is useful.
4. Add or update app-specific skills if the workspace introduces new patterns.

When removing a workspace:

1. Remove root scripts that reference it.
2. Remove dependent workspace references and local file dependencies.
3. Run `npm install` from root to update the lockfile.

## Verification

- Check the importing workspace declares each package it uses.
- Check root `package.json` did not gain unnecessary production dependencies.
- Check Docker contexts still match `docker-compose.yml`.
- Run `./skills/skill-sync/assets/sync.sh` and `./skills/setup.sh --sync` after skill metadata changes.

## Related Skills

- `vendix-core` - Architecture map and app boundaries
- `buildcheck-dev` - Development verification
- `vendix-zoneless-signals` - Frontend web build-sensitive patterns
