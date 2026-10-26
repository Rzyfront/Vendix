---
name: vendix-core
description: >
  Vendix architecture map: apps/libs boundaries, AppType environments, public/private apps,
  domain resolution, mobile boundary, skill ownership. Trigger: understanding Vendix
  architecture, app environments or domains, cross-app work, choosing a skill.
license: MIT
metadata:
  author: rzyfront
  version: "1.2"
  scope: [root]
  auto_invoke:
    - "Understanding Vendix architecture"
    - "Working across apps or shared libraries"
    - "Deciding which Vendix skill owns a pattern"
    - "Understanding Public/Private Apps and Domains"
    - "Understanding Vendix app environments or mobile boundary"
---

# Vendix Core

## Purpose

Use this skill as the architecture map for Vendix. It explains the major apps, app environments, and ownership boundaries; detailed implementation rules live in specialized skills.

## Repository Map

| Area | Path | Technology / Role | Primary Skills |
| --- | --- | --- | --- |
| Backend API | `apps/backend` | NestJS + Prisma: domains, domain resolution, jobs, auth, tenant context | `vendix-backend`, `vendix-prisma`, `vendix-multi-tenant-context` |
| Frontend web | `apps/frontend` | Angular 20: public landing/ecommerce and private admin panels | `vendix-frontend`, `vendix-frontend-*`, `vendix-zoneless-signals`, `vendix-ui-ux` |
| Mobile app | `apps/mobile` | Expo/React Native mobile app (touch only when the task names it) | `mobile-dev`, `mobile-parity-audit` |
| Shared libs | `libs/shared-types`, `libs/print-formats` | Cross-app TypeScript types and print formats | `vendix-monorepo-workspaces`, `vendix-print-geometry` |
| Skills | `skills` | Source of AI agent guidance | global `skill-creator`, `skill-sync` |

## Core Rules

- Use the app-specific skill before editing inside an app.
- Frontend web work under `apps/frontend` must also use `vendix-zoneless-signals`.
- Backend work under `apps/backend` must use backend/Prisma skills that match the change.
- Mobile work under `apps/mobile` only when the task names it explicitly; then load `mobile-dev`.
- Cross-app dependencies, package placement, Docker, and CI/CD belong to `vendix-monorepo-workspaces`.
- Shared types should stay framework-neutral and avoid importing app-specific code.
- Do not duplicate detailed rules here; link to the owning skill.

## App Architecture

### Web App Environments

`AppType` is the canonical app environment concept for the Angular web app. It is synchronized with backend `app_type_enum` and used by `domain_settings.app_type`, `user_settings.app_type`, and frontend app config.

| AppType | Access | User | Typical Route |
| --- | --- | --- | --- |
| `VENDIX_LANDING` | Public | SaaS visitors | `/` |
| `VENDIX_ADMIN` | Private | Vendix super admin | `/super-admin/*` |
| `ORG_LANDING` | Public | Organization visitors | `/` on org domain |
| `ORG_ADMIN` | Private | Organization owner/admin | `/admin/*` |
| `STORE_LANDING` | Public | Store visitors | `/` on store domain |
| `STORE_ADMIN` | Private | Store staff/admin | `/admin/*` |
| `STORE_ECOMMERCE` | Public/customer | Store customers | `/`, catalog, cart, checkout |
| `STORE_DELIVERY` | Private | Carriers (Vendix Repartos) | internal delivery app |

`AppEnvironment` exists as a compatibility alias for `AppType`; prefer `AppType` in new code.

### Domain Resolution

- Frontend web resolves host/app context through `AppConfigService` and backend domain resolution (details in `vendix-frontend`, "Domain / App Config").
- `app_type` determines which app environment loads.
- `domain_type` is legacy/categorization and must not be treated as the primary app selector.
- Authenticated users may have `user_settings.app_type` to select or restore their preferred admin environment.

### Public vs Private

- Public web apps do not require staff/admin JWT for page access, though customer auth may apply to account/checkout features.
- Private admin apps require authentication and role/permission enforcement.
- `panel_ui` controls visible menu modules only; it is not backend authorization.
- Backend permissions and guards remain the source of enforcement for protected operations.

## Ownership Boundaries

| Question / Concern | Owner |
| --- | --- |
| Where should a dependency be installed? | `vendix-monorepo-workspaces` |
| How does Angular web UI use Signals/Zoneless? | `vendix-zoneless-signals` |
| How are admin modules structured? | `vendix-frontend-standard-module` / `vendix-frontend` |
| How are backend domains/API endpoints built? | `vendix-backend` |
| How is tenant/store context resolved? | `vendix-multi-tenant-context` / `vendix-prisma-scopes` |
| How are Prisma schema/migrations handled? | `vendix-prisma` / `vendix-prisma-migrations` |
| `store_settings` / `organization_settings` structure | `vendix-settings-system` |
| Branding and settings source of truth | `vendix-settings-system` / `vendix-frontend-theme` |
| Sidebar/module visibility through `panel_ui` | `vendix-panel-ui` |
| Mobile-native (Expo/React Native) patterns and web parity | `mobile-dev` / `mobile-parity-audit` |

## Related Skills

- `vendix-monorepo-workspaces` - Workspaces, dependencies, Docker, CI/CD
- `vendix-backend` - Backend API implementation patterns
- `vendix-frontend` - Frontend web overview or index
- `vendix-zoneless-signals` - Critical Angular 20 Signals/Zoneless rules
- `vendix-settings-system` - Settings and branding persistence
- `vendix-panel-ui` - Admin module visibility
- `vendix-multi-tenant-context` - Backend tenant context
