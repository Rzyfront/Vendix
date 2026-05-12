---
name: vendix-app-architecture
description: >
  Vendix app environments, public/private web apps, mobile app boundary, and domain/app type resolution.
  Trigger: When asking about different apps, environments (VENDIX_ADMIN, ORG_ADMIN, STORE_ADMIN, STORE_ECOMMERCE), mobile boundaries, or domain logic.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Understanding Public/Private Apps and Domains"
    - "Understanding Vendix app environments or mobile boundary"
---

# Vendix App Architecture

## Purpose

Use this skill to understand Vendix app environments and app boundaries. Detailed settings, panel UI, tenant context, and frontend implementation rules live in their specialized skills.

## App Map

| App Area | Path | Technology | Scope |
| --- | --- | --- | --- |
| Frontend web | `apps/frontend` | Angular 20 | Public landing/ecommerce and private admin panels |
| Mobile app | `apps/mobile` | Expo/React Native | Native/mobile app boundary; detailed mobile skills are a knowledge gap |
| Backend API | `apps/backend` | NestJS + Prisma | Domain resolution, auth, tenancy, APIs |

## Web App Environments

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

`AppEnvironment` exists as a compatibility alias for `AppType`; prefer `AppType` in new code.

## Domain Resolution

- Frontend web resolves host/app context through `AppConfigService` and backend domain resolution.
- `app_type` determines which app environment loads.
- `domain_type` is legacy/categorization and must not be treated as the primary app selector.
- Authenticated users may have `user_settings.app_type` to select or restore their preferred admin environment.

## Ownership Boundaries

| Concern | Owning Skill |
| --- | --- |
| `store_settings` / `organization_settings` structure | `vendix-settings-system` |
| Branding and settings source of truth | `vendix-settings-system` / `vendix-frontend-theme` |
| Sidebar/module visibility through `panel_ui` | `vendix-panel-ui` |
| Backend request tenant context | `vendix-multi-tenant-context` |
| Scoped Prisma access | `vendix-prisma-scopes` |
| Angular web Signals/Zoneless patterns | `vendix-zoneless-signals` |
| Expo/React Native implementation | Knowledge gap until mobile-specific skills are created |

## Public vs Private Rules

- Public web apps do not require staff/admin JWT for page access, though customer auth may apply to account/checkout features.
- Private admin apps require authentication and role/permission enforcement.
- `panel_ui` controls visible menu modules only; it is not backend authorization.
- Backend permissions and guards remain the source of enforcement for protected operations.

## Mobile Boundary

`apps/mobile` is a real Expo/React Native workspace. Existing frontend web skills describe responsive web behavior, not native mobile behavior. When planning mobile work, mark missing guidance as a knowledge gap and propose a focused mobile skill before standardizing patterns.

## Related Skills

- `vendix-core` - Repository-wide architecture map
- `vendix-settings-system` - Settings and branding persistence
- `vendix-panel-ui` - Admin module visibility
- `vendix-multi-tenant-context` - Backend tenant context
- `vendix-zoneless-signals` - Angular web implementation rules
