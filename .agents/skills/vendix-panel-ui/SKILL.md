---
name: vendix-panel-ui
description: >
  Panel UI module visibility system: backend defaults, NgRx selectors, MenuFilterService, module flows, and sidebar filtering.
  Trigger: When adding sidebar modules, configuring panel_ui visibility, debugging menu filtering, or distinguishing visibility from permissions.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Adding modules or submodules to the sidebar"
    - "Configuring panel_ui visibility"
    - "Working with MenuFilterService or menu filtering"
    - "Adding new menu items to admin layouts"
---

# Vendix Panel UI

## Purpose

Use this skill for sidebar/menu visibility. `panel_ui` controls what the user sees in admin navigation; it is not backend authorization.

## Visibility Sources

| Source | Role |
| --- | --- |
| `user_settings.config.panel_ui` | Main per-user module visibility map (nested by `app_type`) |
| `user_settings.app_type` | Selects the active app panel map |
| `DefaultPanelUIService` | Defaults from `default_templates.user_settings_default` with 5-minute cache and hardcoded fallback |
| `mergePanelUiSoft` (backend util) | Lazy merge of defaults into `panel_ui` for privileged roles at read time (login/refresh/env-switch/getSettings) |
| `store_settings.module_flows` | Force-hides operational modules (accounting/payroll/invoicing) when flows disabled |
| `MenuFilterService` | Applies panel keys, store type rules, subscription feature requirements |
| `APP_MODULES` constant | Editable module catalog for settings UI |

## panel_ui Shape (Canonical)

The only supported shape is **nested by `app_type`**:

```jsonc
{
  "ORG_ADMIN":   { "dashboard": true, "stores": true, ... },
  "STORE_ADMIN": { "dashboard": true, "products": true, "products_list": true, ... },
  "STORE_ECOMMERCE": { ... },
  "VENDIX_LANDING": {}
}
```

Flat legacy shape (`{ products: true, dashboard: true }` at top level) is **not supported**. The backend `mergePanelUiSoft` detects it (all top-level values are booleans) and discards it as if the user had no `panel_ui`. Privileged users then get defaults filled in; non-privileged users get `{}`.

## Core Rules

- `panel_ui` is UI visibility only. Protect APIs with permissions/guards.
- Defaults come from `DefaultPanelUIService`, not from the sidebar components.
- **Privileged roles** (`owner`, `admin`, `super_admin`) receive `panel_ui` with defaults merged in at read time (lazy soft merge). They see new modules without needing DB backfill.
- Non-privileged roles (`manager`, `cashier`, `employee`, etc.) get `panel_ui` exactly as stored. Admin must explicitly curate their access.
- `false` values are always respected. Defaults only fill `undefined` keys.
- Menu filtering is label-driven through `MenuFilterService.moduleKeyMap`; label mismatches hide items unexpectedly.
- Array mappings in `moduleKeyMap` mean OR logic across multiple keys.
- Store type, `module_flows`, and subscription gates may hide a module even when `panel_ui[key] === true`.

## Real Backend Flow (Read Path)

Every endpoint that ships `user_settings` to the frontend runs `mergeUserConfigPanelUi(config, defaults, roles)`:

1. Load `user_settings` + user roles + defaults (`DefaultPanelUIService.generatePanelUI('')`).
2. Detect legacy flat shape → discard.
3. If roles match `PRIVILEGED_ROLE_NAMES` → fill `undefined` keys from defaults per `app_type`. Otherwise return user's `panel_ui` as-is.
4. Return new `config` (in-memory only — no DB write).

Read-path call sites:

- `apps/backend/src/domains/auth/auth.service.ts`
  - `getSettings()` — explicit settings refresh endpoint
  - `registerOwner()` response
  - `registerCustomer()` response
  - Main `login()` response
- `apps/backend/src/domains/auth/environment-switch.service.ts` — `userSettingsForResponse` in env switch payload

Backend helpers:

- `apps/backend/src/common/utils/privileged-roles.util.ts` — `PRIVILEGED_ROLE_NAMES = { owner, admin, super_admin }`, `hasPrivilegedRole(roles)`
- `apps/backend/src/common/utils/panel-ui-merge.util.ts` — `mergePanelUiSoft`, `mergeUserConfigPanelUi`, internal `isLegacyFlatPanelUi`
- `apps/backend/src/common/services/default-panel-ui.service.ts` — defaults source (template + fallback)

`PRIVILEGED_ROLE_NAMES` is the **single source of truth** for "who sees everything automatically". Anywhere else that filters by role (e.g. `ELIGIBLE_ROLES` in `superadmin/users/users.service.ts`) reuses this constant via `Array.from(PRIVILEGED_ROLE_NAMES)`.

## Persisted Backfill (Super Admin)

The lazy soft merge does not write to DB. To persist the merge for users (e.g. before changing defaults again, or to capture a snapshot of current state), super_admin uses:

| Endpoint | Purpose |
| --- | --- |
| `GET  /superadmin/users/panel-ui-preview` | Dry-run: counts eligible users, lists missing keys per `app_type`. No writes. |
| `POST /superadmin/users/sync-panel-ui` | Persists merge for eligible users. Body: `{ user_ids?: number[], app_types?: string[], strategy?: 'merge' \| 'replace' }`. Default `merge` (fills missing keys, keeps `false`). `replace` overwrites entire `app_type` map. |

- Guard: `@Roles(UserRole.SUPER_ADMIN)`. No additional permission row required.
- Eligible target users are filtered by `PRIVILEGED_ROLE_NAMES` (i.e. only `owner`, `admin`, `super_admin` are touched by default; other roles are not auto-backfilled).
- Implementation: `apps/backend/src/domains/superadmin/users/users.service.ts:syncPanelUI`.

## Real Frontend Flow

1. Auth state stores `user_settings` from login/session restore (already merged by backend if user is privileged).
2. Selectors read `user_settings.config.panel_ui`.
3. Selectors choose the active map using `user_settings.app_type`.
4. `selectVisibleModules` returns keys whose value is `true`, after module-flow adjustments.
5. `MenuFilterService.filterMenuItems(...)` filters layout menu items recursively.

Frontend key files:

- `apps/frontend/src/app/core/store/auth/auth.selectors.ts`
- `apps/frontend/src/app/core/store/auth/auth.facade.ts`
- `apps/frontend/src/app/core/services/menu-filter.service.ts`
- `apps/frontend/src/app/shared/constants/app-modules.constant.ts`
- `apps/frontend/src/app/private/layouts/store-admin/store-admin-layout.component.ts`
- `apps/frontend/src/app/private/layouts/organization-admin/organization-admin-layout.component.ts`

## Adding A Module Or Submodule

1. Add the key to `DefaultPanelUIService.PANEL_UI_FALLBACK` (hardcoded fallback) under the right `app_type`.
2. Update `default_templates.user_settings_default` via seed if the key must exist for newly-created users.
3. Add the key to `APP_MODULES` so users/admins can toggle it in the settings UI.
4. Add or verify the Spanish label mapping in `MenuFilterService.moduleKeyMap`.
5. Add the menu item in the owning layout.
6. Add the lazy route for the module.
7. Add backend permissions/guards separately if the feature exposes protected APIs.

Submodule keys should follow `parent_child`, for example `orders_sales` or `settings_domains`, unless existing code already uses a different key.

**No DB backfill needed for privileged users.** Owners/admins/super_admins see the new key automatically on next request (lazy soft merge). For non-privileged users the admin must either toggle the key in the settings UI per user, or super_admin can run `POST /superadmin/users/sync-panel-ui` after temporarily widening the eligible role set if a bulk operation is needed.

## Pitfalls

- **Adding a new key without touching `DefaultPanelUIService.PANEL_UI_FALLBACK`**: only privileged users get it (via merge), and even then only after the template cache (5 min TTL) hits the fallback path. Update both fallback and template.
- **Trusting `panel_ui` for security**: it's UI only. Always pair with `PermissionsGuard` / `@Permissions` on the backend.
- **Flat `panel_ui` in DB**: the read-path utility discards it. Don't write flat shape from any handler or seed. If you find one, sync it via the super_admin endpoint (`strategy: 'replace'`) to overwrite cleanly.
- **`ELIGIBLE_ROLES` drift**: any role list outside `PRIVILEGED_ROLE_NAMES` will silently mis-match the seed and act as a no-op. Always import from `privileged-roles.util.ts`.
- **Forgetting label mapping**: a new menu item with a label not in `MenuFilterService.moduleKeyMap` falls into the "no mapping" branch and is only shown if it has visible children. Easy to miss in tests.
- **`generatePanelUI(_app_type)` ignores its argument** — the underscore is a hint. It always returns the full nested map.

## Visibility vs Authorization

| Concern | System |
| --- | --- |
| Hide/show sidebar item | `panel_ui`, `module_flows`, store type, subscription filtering |
| Allow/deny API operation | `PermissionsGuard`, roles, auth guards, subscription guards |
| Show a module but block writes | Feature gate/subscription guard |
| Grant permission but hide menu | Possible; visibility and authorization are separate |

## Related Skills

- `vendix-permissions` - Backend authorization
- `vendix-settings-system` - Settings persistence and defaults
- `vendix-subscription-gate` - Subscription-based feature access
- `vendix-frontend-routing` - Lazy routes for modules
