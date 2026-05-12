---
name: vendix-core
description: >
  Vendix repository architecture, app boundaries, and cross-app guidance.
  Trigger: When understanding Vendix architecture, working across apps/libs, or deciding which specialized skill owns a pattern.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Understanding Vendix architecture"
    - "Working across apps or shared libraries"
    - "Deciding which Vendix skill owns a pattern"
---

# Vendix Core

## Purpose

Use this skill as the architecture map for Vendix. It explains the major apps and ownership boundaries; detailed implementation rules live in specialized skills.

## Repository Map

| Area | Path | Role | Primary Skills |
| --- | --- | --- | --- |
| Backend API | `apps/backend` | NestJS API, Prisma, domains, jobs, auth, tenant context | `vendix-backend`, `vendix-prisma`, `vendix-multi-tenant-context` |
| Frontend web | `apps/frontend` | Angular 20 admin/ecommerce web app | `vendix-frontend-*`, `vendix-zoneless-signals`, `vendix-ui-ux` |
| Mobile app | `apps/mobile` | Expo/React Native mobile app | Knowledge gap until mobile-specific skills are created |
| Shared types | `libs/shared-types` | Cross-app TypeScript type package | `vendix-monorepo-workspaces` |
| Skills | `skills` | Source of AI agent guidance | `skill-creator`, `skill-sync` |

## Core Rules

- Use the app-specific skill before editing inside an app.
- Frontend web work under `apps/frontend` must also use `vendix-zoneless-signals`.
- Backend work under `apps/backend` must use backend/domain/Prisma skills that match the change.
- Mobile work under `apps/mobile` is a current knowledge gap unless a mobile-specific skill exists for the task.
- Cross-app dependencies, package placement, Docker, and CI/CD belong to `vendix-monorepo-workspaces`.
- Shared types should stay framework-neutral and avoid importing app-specific code.
- Do not duplicate detailed rules here; link to the owning skill.

## App Boundary Rules

| Question | Owner |
| --- | --- |
| Where should a dependency be installed? | `vendix-monorepo-workspaces` |
| How does Angular web UI use Signals/Zoneless? | `vendix-zoneless-signals` |
| How are admin modules structured? | `vendix-frontend-standard-module` / `vendix-frontend-module` |
| How are backend domains/API endpoints built? | `vendix-backend-domain` / `vendix-backend-api` |
| How is tenant/store context resolved? | `vendix-multi-tenant-context` / `vendix-prisma-scopes` |
| How are Prisma schema/migrations handled? | `vendix-prisma-schema` / `vendix-prisma-migrations` |
| How are mobile-native patterns handled? | Knowledge gap until mobile skill exists |

## Mobile Knowledge Gap

Vendix has `apps/mobile` using Expo/React Native, but the current skill set is mostly backend and web frontend. When planning or editing mobile work, mark missing native-mobile guidance as a knowledge gap and propose a focused skill such as `vendix-mobile` or `vendix-mobile-navigation`.

## Related Skills

- `vendix-monorepo-workspaces` - Workspaces, dependencies, Docker, CI/CD
- `vendix-app-architecture` - Product app environments and domain behavior
- `vendix-backend` - Backend API implementation patterns
- `vendix-frontend` - Frontend web overview or index
- `vendix-zoneless-signals` - Critical Angular 20 Signals/Zoneless rules
