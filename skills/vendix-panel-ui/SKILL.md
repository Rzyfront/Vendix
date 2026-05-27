---
name: vendix-panel-ui
description: >
  Panel UI module visibility system: backend defaults, NgRx selectors, MenuFilterService, module flows, and sidebar filtering.
  Trigger: When adding sidebar modules, configuring panel_ui visibility, debugging menu filtering, or distinguishing visibility from permissions.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.3"
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

## ⚠️ Critical Plan Decisions (mandatory before implementation)

Any plan that introduces a new module or submodule MUST explicitly answer these two questions in writing. If the plan does not declare these decisions, **block execution** and ask the human.

1. **`default_visible_for_privileged_users`** (`true` / `false`)
   - `true` (recommended for features useful to everyone): owner / admin / super_admin see the item automatically on next login. Set the fallback value to `true`.
   - `false` (experimental or super_admin-only): hidden by default; admin must enable it per-user from the settings UI. Set the fallback value to `false`.

2. **`show_new_badge`** (`yes` / `no`, default `yes`)
   - `yes` (recommended whenever the item is meant to be discovered): the **user dropdown banner** ("Tienes N módulos nuevos disponibles") and the **Settings → General → "Módulos del Panel"** section surface the key as new until the user toggles/activates it.
   - `no`: silent rollout. Only for admin-only utilities that do not need discoverability.
   - **The sidebar does NOT render a "Nuevo" badge anymore** — it was removed for being too intrusive. Discovery lives only in the user dropdown banner and the Settings module list.

The plan must include a one- or two-line justification for each decision. PRs that add a key to `PANEL_UI_FALLBACK` without these decisions documented must be rejected in review.

## Visibility Sources

| Source | Role |
| --- | --- |
| `user_settings.config.panel_ui` | Main per-user module visibility map (nested by `app_type`) |
| `user_settings.config.panel_ui_seen_keys` | Per-user record of which module keys the user has interacted with (drives "Nuevo" badge) |
| `user_settings.config.new_keys` | Computed at read time: defaults keys not yet seen by the user (only for privileged roles) |
| `user_settings.app_type` | Selects the active app panel map |
| `DefaultPanelUIService` | Defaults from `default_templates.user_settings_default` deep-merged with hardcoded `PANEL_UI_FALLBACK`, with 5-minute cache |
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
- **Every key added to `PANEL_UI_FALLBACK` appears automatically** for privileged users with no DB write and no seed run. This is guaranteed by the auto-merge in `getUnifiedTemplate()` (see Real Backend Flow).
- **"Nuevo" badge system**: keys present in defaults but missing from `user_settings.config.panel_ui_seen_keys[app_type]` are surfaced via `new_keys` on every read. Discovery is shown **only in the user dropdown banner** and the **Settings → General → "Módulos del Panel"** section — never in the sidebar (intrusive).
- For non-privileged users (`manager`, `cashier`, `employee`), the badge does not apply: they only see the key after an admin toggles it in the settings UI or super_admin runs `POST /superadmin/users/sync-panel-ui`.

## Real Backend Flow (Read Path)

### Template resolution — `DefaultPanelUIService.getUnifiedTemplate()`

This method now performs a **deep merge** between the DB template and the hardcoded `PANEL_UI_FALLBACK`:

1. Load template from DB (`default_templates.user_settings_default`).
2. For each `app_type` in `PANEL_UI_FALLBACK`:
   - For each `key: value`:
     - If the DB template already has the key → respect DB (including `false`).
     - If the DB template does NOT have the key → take the fallback value.
3. Cache the merged template for 5 minutes.

**Consequence**: adding a key to `PANEL_UI_FALLBACK` is sufficient for it to appear in production for privileged users. No seed run, no migration, no DB write required. The (optional) seed update remains good hygiene for fresh user creation but is no longer load-bearing for visibility.

### Per-user lazy soft merge

Every endpoint that ships `user_settings` to the frontend runs `mergeUserConfigPanelUi(config, defaults, roles)`:

1. Load `user_settings` + user roles + defaults (`DefaultPanelUIService.generatePanelUI('')`, which already includes the auto-merge above).
2. Detect legacy flat shape → discard.
3. If roles match `PRIVILEGED_ROLE_NAMES` → fill `undefined` keys from defaults per `app_type`. Otherwise return user's `panel_ui` as-is.
4. Compute `new_keys` (see "Nuevo" Badge System).
5. Return new `config` (in-memory only — no DB write).

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
- `apps/backend/src/common/services/default-panel-ui.service.ts` — defaults source (template + fallback auto-merge)

`PRIVILEGED_ROLE_NAMES` is the **single source of truth** for "who sees everything automatically". Anywhere else that filters by role (e.g. `ELIGIBLE_ROLES` in `superadmin/users/users.service.ts`) reuses this constant via `Array.from(PRIVILEGED_ROLE_NAMES)`.

## "Nuevo" Badge System

### Computation

On every read path (login, refresh, env switch, `getSettings`), the backend computes:

```ts
new_keys[app_type] = defaults[app_type].keys.filter(
  k => !user.panel_ui_seen_keys[app_type]?.includes(k)
);
```

Only computed for privileged roles. Returned on `user_settings.config.new_keys`.

### Marking a key as seen

- Endpoint: `POST /api/auth/panel-ui/mark-seen`
- Body: `{ key: string, app_type: string }`
- Effect: appends `key` to `user_settings.config.panel_ui_seen_keys[app_type]`.
- Auth: any authenticated user.

### Frontend surfaces (where "Nuevo" is visible)

- **User dropdown banner** — renders "Tienes N módulos nuevos disponibles. Actívalos en Configuración." using `new_keys.length`.
- **User dropdown settings link badge** — shows the count `N` next to the "Configuración" entry.
- **Settings → General → "Módulos del Panel"** — every module row whose key is in `new_keys` shows the "Nuevo" indicator. Toggling/saving consumes the key via `authFacade.markPanelUiSeen(key, app_type)`.

`MenuFilterService.isNewModule(label)` and `getNewKeyForLabel(label)` remain exported so other UI surfaces can opt-in to render discovery hints — but the **sidebar must not** (decision after rev1 UX feedback).

### Compatibility

Clients without `panel_ui_seen_keys` (first request after deploy) see **all** existing module keys as "Nuevo" in the dropdown banner and Settings list. The keys are then consumed gradually as the user activates them in Settings. This is intentional and self-healing.

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

1. Auth state stores `user_settings` from login/session restore (already merged by backend if user is privileged; includes `new_keys`).
2. Selectors read `user_settings.config.panel_ui`.
3. Selectors choose the active map using `user_settings.app_type`.
4. `selectVisibleModules` returns keys whose value is `true`, after module-flow adjustments.
5. `MenuFilterService.filterMenuItems(...)` filters layout menu items recursively.
6. The sidebar does NOT call `isNewModule(label)` for badges anymore. Discovery hints are rendered by the user-dropdown banner and the Settings → General "Módulos del Panel" section.
7. `authFacade.markPanelUiSeen(key, app_type)` is dispatched from those surfaces (e.g. when the user toggles a module ON in Settings), never from a sidebar click.

Frontend key files:

- `apps/frontend/src/app/core/store/auth/auth.selectors.ts`
- `apps/frontend/src/app/core/store/auth/auth.facade.ts`
- `apps/frontend/src/app/core/services/menu-filter.service.ts`
- `apps/frontend/src/app/shared/constants/app-modules.constant.ts`
- `apps/frontend/src/app/private/layouts/store-admin/store-admin-layout.component.ts`
- `apps/frontend/src/app/private/layouts/organization-admin/organization-admin-layout.component.ts`

## Adding A Module Or Submodule — Checklist

**Before any code edit**, the plan must record:

- [ ] Decision `default_visible_for_privileged_users` (`true` / `false`) — mandatory.
- [ ] Decision `show_new_badge` (`yes` / `no`, default `yes`) — mandatory.
- [ ] One- or two-line justification for each decision.

**Implementation steps**:

1. Add the key to `DefaultPanelUIService.PANEL_UI_FALLBACK` under the correct `app_type`, with the value chosen in decision #1.
2. (Optional, hygienic) Add the key to the seed `default_templates.user_settings_default` as well — not required, since auto-merge in `getUnifiedTemplate()` covers visibility.
3. Add the key to `APP_MODULES` (frontend constant `apps/frontend/src/app/shared/constants/app-modules.constant.ts`) under the right `app_type` and parent (e.g. submodules of "Configuración" go inside `settings.children[]`). **This is the pillar of admin curation**: without this entry the module cannot be toggled from `Settings → "Módulos del Panel"` nor from `Settings → Users → "Editar usuario"`, even if it shows up correctly in the sidebar. Forgetting this is the #1 cause of "I added a module but admin cannot enable/disable it per user".
4. Verify the label mapping in `MenuFilterService.moduleKeyMap` (single string or array for OR logic).
5. Add the menu item in the owning layout. The sidebar will not render any "Nuevo" badge — discoverability comes from the user-dropdown banner and Settings → "Módulos del Panel".
6. Add the lazy route. Apply backend permission/guard on the route if the feature exposes protected APIs.
7. Add the backend permission row and guard separately for the protected APIs.

Submodule keys should follow `parent_child`, for example `orders_sales` or `settings_domains`, unless existing code already uses a different key.

**No DB backfill needed for privileged users.** Owners/admins/super_admins see the new key automatically on next request (auto-merge in template + lazy soft merge per user). For non-privileged users the admin must either toggle the key in the settings UI per user, or super_admin can run `POST /superadmin/users/sync-panel-ui` after temporarily widening the eligible role set if a bulk operation is needed.

## Pitfalls

- **Skipping Critical Plan Decisions**: any PR that adds a key to `PANEL_UI_FALLBACK` without the two decisions documented in the plan must be rejected in review.
- **Trusting `panel_ui` for security**: it's UI only. Always pair with `PermissionsGuard` / `@Permissions` on the backend.
- **Flat `panel_ui` in DB**: the read-path utility discards it. Don't write flat shape from any handler or seed. If you find one, sync it via the super_admin endpoint (`strategy: 'replace'`) to overwrite cleanly.
- **`ELIGIBLE_ROLES` drift**: any role list outside `PRIVILEGED_ROLE_NAMES` will silently mis-match the seed and act as a no-op. Always import from `privileged-roles.util.ts`.
- **Forgetting label mapping**: a new menu item with a label not in `MenuFilterService.moduleKeyMap` falls into the "no mapping" branch and is only shown if it has visible children. Easy to miss in tests.
- **Forgetting `APP_MODULES` entry**: the module appears in the sidebar but **admin cannot toggle it** from `Settings → "Módulos del Panel"` nor from the per-user edit modal. Symptom: "the module is visible to me but I cannot enable/disable it for other users". Fix: add an entry under the correct `app_type` and parent in `apps/frontend/src/app/shared/constants/app-modules.constant.ts`.
- **`generatePanelUI(_app_type)` ignores its argument** — the underscore is a hint. It always returns the full nested map.
- **"Nuevo" badge does not appear**: verify (a) auto-merge in `getUnifiedTemplate()` actually includes the new key in the resolved template, (b) the user has a privileged role, (c) the template cache is not stale beyond the 5-minute TTL after a redeploy.
- **Relying on the seed for visibility**: the seed only affects newly-created `default_templates` rows. Auto-merge in `getUnifiedTemplate()` is what covers the "key added after the initial seed" case — no re-seed required, but keep the seed in sync for hygiene.

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
- `how-to-plan` - Must record the two Critical Plan Decisions whenever a plan introduces a module or submodule
