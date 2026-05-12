---
name: vendix-settings-system
description: >
  Store and organization settings persistence, defaults, templates, branding, and frontend integration.
  Trigger: When working with settings configuration, adding settings sections, modifying store_settings/organization_settings, or debugging settings defaults/sync.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Adding new settings sections to stores or organizations"
    - "Modifying store_settings or organization_settings"
    - "Working with default_templates"
    - "Understanding settings inheritance and defaults"
---

# Vendix Settings System

## Purpose

Use this skill for `store_settings`, `organization_settings`, hardcoded defaults, manual templates, branding persistence, and settings UI integration. Use `vendix-panel-ui` for sidebar/module visibility details.

## Current Sources Of Truth

| Concern | Source |
| --- | --- |
| Store settings defaults | `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts` |
| Store settings type | `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts` |
| Store settings API | `apps/backend/src/domains/store/settings/settings.service.ts` and controller |
| Organization settings defaults | `apps/backend/src/domains/organization/settings/defaults/default-organization-settings.ts` |
| Organization settings API | `apps/backend/src/domains/organization/settings/settings.service.ts` and controller |
| Manual templates | `default_templates` seeded by `apps/backend/prisma/seeds/default-templates.seed.ts` |
| Store settings frontend | `apps/frontend/src/app/private/modules/store/settings/general/*` |

## Core Rules

- `store_settings.settings.branding` is the source of truth for store branding.
- Legacy `app` settings are generated or mapped for frontend compatibility; do not make `app` the new source of truth.
- Store operational fields still sync with `stores`: `name`, `logo_url`, `store_type`, and `timezone`.
- Store settings updates sanitize logo/favicon URLs; never persist signed S3 URLs.
- `getDefaultStoreSettings()` is the primary store default path.
- `default_templates.store_default_settings` is manual/template-based and may lag hardcoded defaults; do not treat it as the only source of defaults.
- Organization settings are simpler full-JSON settings through GET/PUT; do not document branding-only endpoints unless they exist.
- Frontend store settings currently use signals and explicit save through `saveSettingsNow()`, not BehaviorSubject autosave.

## Adding A Store Settings Section

1. Add or update the interface in `store-settings.interface.ts`.
2. Add hardcoded defaults in `default-store-settings.ts`.
3. Add DTO validation in `settings-schemas.dto.ts` and `update-settings.dto.ts`.
4. Update `settings.service.ts` merge/sync logic only if the section affects other tables.
5. Update frontend interfaces/components if the section is user-editable.
6. Update `default_templates` only if manual template application should include the section.

## Branding And S3 URLs

- Store S3 keys, not signed URLs.
- On update, extract keys before persisting logo/favicon values.
- On read/public exposure, sign keys with S3 service when a public URL is needed.
- Use `vendix-s3-storage` before editing upload or URL persistence behavior.

## Frontend Integration

The current store settings UI uses Angular signals for local state and explicit save actions. Do not reintroduce legacy `BehaviorSubject` autosave examples without checking the current component/service.

Key files:

- `apps/frontend/src/app/private/modules/store/settings/general/services/store-settings.service.ts`
- `apps/frontend/src/app/private/modules/store/settings/general/general-settings.component.ts`

## Ownership Boundaries

| Need | Use |
| --- | --- |
| Sidebar/module visibility | `vendix-panel-ui` |
| Theme tokens and CSS variables | `vendix-frontend-theme` |
| S3 logo/favicon handling | `vendix-s3-storage` |
| Prisma schema changes | `vendix-prisma-schema` and `vendix-prisma-migrations` |
| Mobile-native settings UI | Knowledge gap until mobile skills exist |

## Related Skills

- `vendix-panel-ui` - `panel_ui` menu visibility
- `vendix-s3-storage` - Logo/favicon URL handling
- `vendix-zoneless-signals` - Frontend signals patterns
- `vendix-prisma-schema` - Settings schema changes
