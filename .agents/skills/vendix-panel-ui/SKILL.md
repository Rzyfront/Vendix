---
name: vendix-panel-ui
description: >
  Panel UI module visibility system: industry dimension (stores.industries), store-level
  ceiling (store_settings.settings.panel_ui), per-user panel_ui, NgRx selectors,
  MenuFilterService, module flows, and sidebar filtering.
  Trigger: When adding sidebar modules, configuring panel_ui visibility, editing
  industry rules in INDUSTRY_HIDDEN_MODULES, adding per-industry module rules,
  debugging menu filtering, or distinguishing visibility from permissions.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.4"
  scope: [root]
  auto_invoke:
    - "Adding modules or submodules to the sidebar"
    - "Configuring panel_ui visibility"
    - "Working with MenuFilterService or menu filtering"
    - "Adding new menu items to admin layouts"
    - "Editing industry rules in INDUSTRY_HIDDEN_MODULES"
    - "Adding or editing per-industry module rules"
---

# Vendix Panel UI

## Purpose

Use this skill for sidebar/menu visibility. Effective visibility crosses three layers
— **industry availability**, **store panel UI**, and **per-user panel UI** — plus the
existing `store_type` / `module_flows` / operating-scope / fiscal-scope / subscription
filters. `panel_ui` controls what the user sees in admin navigation; it is not backend
authorization.

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

> **Reminder (industry / store-panel-UI plan):** a plan that adds the new
> "Módulos de la Tienda" card as a *sub-card inside* the existing `settings_general`
> page adds **no new module key** to `PANEL_UI_FALLBACK` or `APP_MODULES`, so both
> decisions are **N/A**. If a follow-up plan turns that card into its own submodule
> key, that plan must record both decisions explicitly.

## Visibility Sources

Effective visibility = **industry availability ∩ store panel UI ∩ user panel UI** ∩
`store_type` ∩ `module_flows` ∩ operating-scope ∩ fiscal-scope ∩ subscription gates.

| Source | Role |
| --- | --- |
| `stores.industries` (Postgres `industry_enum[]`) | Multi-select industry list on the store row; default `['retail']`; mirrored in `store_settings.settings.general.industries` |
| `INDUSTRY_HIDDEN_MODULES` (frontend constant) | `Record<StoreIndustry, string[]>` of module keys hidden per industry; OR semantics across the store's industries; consumed by `MenuFilterService` and both per-user config surfaces (single source) |
| `store_settings.settings.panel_ui` (existing `PanelUISettings`) | Store-wide ceiling; **absent = allowed, `false` = hidden for the whole store**; editable by the owner from "Módulos de la Tienda" card inside `settings_general`; capped by industry (industry-disallowed toggles render disabled) |
| `user_settings.config.panel_ui` | Main per-user module visibility map (nested by `app_type`) |
| `user_settings.config.panel_ui_seen_keys` | Per-user record of which module keys the user has interacted with (drives "Nuevo" badge) |
| `user_settings.config.new_keys` | Computed at read time: defaults keys not yet seen by the user (only for privileged roles) |
| `user_settings.app_type` | Selects the active app panel map |
| `DefaultPanelUIService` | Defaults from `default_templates.user_settings_default` deep-merged with hardcoded `PANEL_UI_FALLBACK`, with 5-minute cache |
| `mergePanelUiSoft` (backend util) | Lazy merge of defaults into `panel_ui` for privileged roles at read time (login/refresh/env-switch/getSettings) |
| `store_settings.module_flows` | Force-hides operational modules (accounting/payroll/invoicing) when flows disabled |
| `MenuFilterService` | Applies the triple crossing (industry ∩ store panel UI ∩ user panel UI) plus `store_type` rules and subscription feature requirements |
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

The store-level `store_settings.settings.panel_ui` reuses the same canonical shape per
`app_type` (typically only `STORE_ADMIN` is populated — industries are store-scoped and
do not gate `ORG_ADMIN` modules).

## Core Rules

- `panel_ui` is UI visibility only. Protect APIs with permissions/guards.
- Defaults come from `DefaultPanelUIService`, not from the sidebar components.
- **Privileged roles** (`owner`, `admin`, `super_admin`) receive `panel_ui` with defaults merged in at read time (lazy soft merge). They see new modules without needing DB backfill.
- Non-privileged roles (`manager`, `cashier`, `employee`, etc.) get `panel_ui` exactly as stored. Admin must explicitly curate their access.
- `false` values are always respected. Defaults only fill `undefined` keys.
- Menu filtering is label-driven through `MenuFilterService.moduleKeyMap`; label mismatches hide items unexpectedly.
- Array mappings in `moduleKeyMap` mean OR logic across multiple keys.
- Store type, `module_flows`, subscription gates, **industry**, and **store panel UI** may hide a module even when `panel_ui[key] === true`.
- **Every key added to `PANEL_UI_FALLBACK` appears automatically** for privileged users with no DB write and no seed run. This is guaranteed by the auto-merge in `getUnifiedTemplate()` (see Real Backend Flow).
- **"Nuevo" badge system**: keys present in defaults but missing from `user_settings.config.panel_ui_seen_keys[app_type]` are surfaced via `new_keys` on every read. Discovery is shown **only in the user dropdown banner** and the **Settings → General → "Módulos del Panel"** section — never in the sidebar (intrusive).
- For non-privileged users (`manager`, `cashier`, `employee`), the badge does not apply: they only see the key after an admin toggles it in the settings UI or super_admin runs `POST /superadmin/users/sync-panel-ui`.

## Industry Dimension — `stores.industries` + `INDUSTRY_HIDDEN_MODULES`

### Source of truth

- Backend: `stores.industries industry_enum[]` (Postgres enum array, default `ARRAY['retail']::industry_enum[]`).
- Mirrored in `store_settings.settings.general.industries` (same pattern as `store_type`).
- TS enum: `StoreIndustry` in `apps/backend/src/domains/store/stores/dto/index.ts` — values `retail | restaurant | manufacturing | service`. Closed enum, additive only.
- DTO validators (body): `@IsOptional() @IsArray() @ArrayMinSize(1) @IsEnum(StoreIndustry, { each: true })`. The `@ArrayMinSize(1)` is load-bearing — it prevents JSON/column drift by rejecting empty arrays with an explicit 400 instead of silently no-opping.
- DTO transform (query): `@Transform(({ value }) => Array.isArray(value) ? value : [value])` **before** validation so single `?industries=restaurant` works alongside the repeated-param form.
- Frontend mirror: `apps/frontend/src/app/core/models/store-settings.interface.ts` (`GeneralSettings.industries: StoreIndustry[]`).

### Default

`getDefaultStoreSettings().general.industries === ['retail']` (and the column default `ARRAY['retail']`). Existing tenants are unchanged by the migration.

### `INDUSTRY_HIDDEN_MODULES` — single source

```ts
// apps/frontend/src/app/shared/constants/industry-modules.constant.ts
export const INDUSTRY_HIDDEN_MODULES: Record<StoreIndustry, string[]> = {
  retail:        [],   // intentionally empty in the foundation plan
  restaurant:    [],
  manufacturing: [],
  service:       [],
};

export function getModulesHiddenByIndustries(industries: string[]): string[] {
  // OR semantics: a module is hidden only if hidden for EVERY industry of the store.
  // Implementation = set-intersection of the per-industry hidden lists.
  // If `industries` is empty, falls back to ['retail'] so the call is always defined.
}
```

**This is the lock.** All per-industry module rules live here — never inline in
`MenuFilterService`, `settings-modal.component.ts`, or
`store-user-edit-modal.component.ts`. The three consumers stay in sync because there is
exactly one source. Adding a new per-industry rule means adding a module key string to
the relevant industry's array; no other code changes are required.

The map is **intentionally empty** in the foundation plan (per `planning/industry-field-foundation-plan.md`). Follow-up plans (restaurant Operations / recipes, KDS, manufacturing, services) populate the map and may propose a dedicated `vendix-store-industries` skill once real per-industry behavior lands.

### Snapshot fallback

When `storeSettings` has not loaded yet (first paint before settings request returns),
`authFacade.userIndustries$` / `userIndustries` signal is the snapshot. **The JWT is
NOT extended** with `industries` — settings is the source of truth. If both sources
are empty the runtime falls back to `['retail']` defensively so the filter is always
defined.

```ts
// apps/frontend/src/app/core/services/menu-filter.service.ts (read path)
const industries =
  storeSettings?.general?.industries?.length
    ? storeSettings.general.industries
    : (loginIndustries?.length ? loginIndustries : ['retail']);
const hiddenByIndustries = getModulesHiddenByIndustries(industries);
const hiddenByStorePanel = Object.keys(storeSettings?.panel_ui?.STORE_ADMIN ?? {})
  .filter(k => storeSettings?.panel_ui?.STORE_ADMIN?.[k] === false);
```

## Store-Level Dimension — `store_settings.settings.panel_ui`

### Source of truth

- Backend: `store_settings.settings.panel_ui` (existing unused `PanelUISettings` interface at `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts:219-224`, field declared at ~303). **Reused as-is — no new shape invented.**
- Frontend: mirrored on `apps/frontend/src/app/core/models/store-settings.interface.ts` if not already present.

### Editing UI

The store-level config is edited from a new **"Módulos de la Tienda"** card inside
`/admin/settings/general` (the existing `settings_general` page) — **no new module
key** is added to `APP_MODULES` (Critical Plan Decisions N/A per the foundation plan).
The card lists `APP_MODULES.STORE_ADMIN` and renders toggles; industry-disallowed
modules render **disabled with a "No disponible para tu industria" hint** (once the
rules map is non-empty; today the card is fully enabled).

### Semantics

- **Absent = allowed** (existing tenants without the key in their settings JSON are unchanged).
- `false` = hidden for the whole store (overrides the user's per-user `panel_ui` value).
- `true` = no-op at this layer (user layer still controls).

### Ceiling rule

The store ceiling is **capped by industry**: a module hidden by `INDUSTRY_HIDDEN_MODULES`
is not toggleable from the store card. The card must reflect this so the owner never
sees a `true` they can never restore.

## Triple-Crossing Order — `MenuFilterService` Filter Chain

Effective visibility is computed in this exact order. **A later step can never widen
a module that an earlier step has hidden.** The chain is AND across all steps.

1. **Industry availability** — `getModulesHiddenByIndustries(storeIndustries)`. Hides modules hidden for **all** of the store's industries (set-intersection).
2. **Store panel UI** — `storeSettings?.panel_ui?.STORE_ADMIN?.[key] === false` hides store-wide. Absent / `true` / `undefined` = allowed at this layer.
3. **User panel UI** — `user_settings.config.panel_ui[app_type][key] === true` (after `mergePanelUiSoft` for privileged roles). `false` / absent = hidden.
4. **`store_type`** — existing `storeTypeHiddenModules` map in `MenuFilterService:30-35`.
5. **Module flows** — `store_settings.module_flows` (operational modules like accounting / payroll / invoicing).
6. **Operating scope / fiscal scope** — store vs organization visibility (`vendix-operating-scope`, `vendix-fiscal-scope`).
7. **Subscription gates** — `vendix-subscription-gate` (`sub:features:{storeId}` Redis cache, `StoreOperationsGuard`).

This order matters: industry caps what the store card can toggle, the store card
caps what the user can toggle, the user choice is the final on/off. Existing layers
(store_type / flows / scopes / subscription) layer on top and remain unchanged.

## Render Único — `app-panel-ui-modules-editor`

**Single render source.** The module-tree UI (parent→children grouping, "Herramientas
Directas", parent/child cascade, gating display, search, "Nuevo" badge) lives in ONE
shared presentational component — never re-implement the tree in a consumer:

`apps/frontend/src/app/shared/components/panel-ui-modules-editor/panel-ui-modules-editor.component.ts`

It is **storage-agnostic**: receives a resolved `Record<string, boolean>` for a single
`app_type` and emits the updated map. The consumer owns persistence + save semantics.
Adding a module to `APP_MODULES` therefore appears in **every** surface automatically.

### Contract

| Member | Meaning |
| --- | --- |
| `appType` (input, required) | Which `APP_MODULES[appType]` catalog to render |
| `value` (input, required) | Resolved `Record<string,boolean>` for that `app_type`; absent / `true` = allowed |
| `hiddenByIndustry` / `hiddenByStore` (inputs) | Gated keys → rendered disabled + reason badge ("Industria"/"Tienda") |
| `newKeys` (input) | Keys that show the "Nuevo" badge (per-user discovery) |
| `searchable`, `parentSync`, `readOnly` (inputs) | UI toggles |
| `valueChange` (output) | Full `Record<string,boolean>` for the `app_type`, **omitting gated keys** so the consumer merges straight into its store |

### Consumers (all four use the shared component)

| Surface | Storage the consumer owns | Save semantics |
| --- | --- | --- |
| `general-settings-form` (store, `/admin/settings/general`) | mirror map from `panelUi` input | emits `{ STORE_ADMIN: { key:false } }` (only OFF keys) |
| `settings-modal` (user's own config) | nested `FormGroup` `panel_ui.{appType}.{key}` | `buildPanelUiDiff` excludes gated, preserves stored value |
| `store-user-edit-modal` (admin edits a store user) | signal `localPanelUI[appType][key]` | `buildPanelUIDiff` from `originalPanelUI` snapshot, excludes gated |
| `user-config-modal` (org user) | `localPanelUi` map per `app_type` | full nested map; catalog tabs use the editor, `STORE_ECOMMERCE`/`VENDIX_LANDING` stay on "Avanzado (JSON)" (no catalog yet) |

## Gating of Per-User Config Surfaces

The two per-user panel-UI config UIs must **gate** their toggles by the **industry ∩
store panel UI** ceiling, so a user toggle can never enable a module above the
ceiling. Both render through `app-panel-ui-modules-editor` (see above); each computes
the gating arrays from the single sources and passes them in — the component only
displays the disabled state + badge and omits gated keys on emit.

| Surface | File | App type(s) gated |
| --- | --- | --- |
| User's own config ("Módulos del Panel") | `apps/frontend/src/app/shared/components/settings-modal/settings-modal.component.ts` | `STORE_ADMIN` (industries are store-scoped; `ORG_ADMIN` is untouched) |
| Admin edits another user (pestaña "Modulos") | `apps/frontend/src/app/private/modules/store/settings/users/components/store-user-edit-modal.component.ts` | `STORE_ADMIN` |

### Gating rule (mandatory)

For each toggle in `APP_MODULES.STORE_ADMIN`:

- Compute `hiddenByIndustries = getModulesHiddenByIndustries(storeIndustries)`.
- Compute `hiddenByStorePanel = panel_ui?.STORE_ADMIN?.[key] === false`.
- If `hiddenByIndustries.includes(key)` or `hiddenByStorePanel`:
  - Render the toggle **disabled** (not hidden).
  - Attach a **reason badge**: `"Industria"` (industry) or `"Tienda"` (store panel UI). When both apply, the industry badge takes precedence.
  - **Exclude the toggle from the save payload diff.** The stored user value is preserved untouched — if the industry later re-allows the module, the user's previous preference resurfaces.

This is the only way a user can discover **why** a module cannot be enabled. Hiding it
silently would have users wondering where it went.

## Per-Industry Rules — Single Source of Truth

**Lock:** all per-industry module rules belong in
`apps/frontend/src/app/shared/constants/industry-modules.constant.ts`. They must
**never** be inlined in `MenuFilterService`, `settings-modal.component.ts`,
`store-user-edit-modal.component.ts`, or any other component. This is what prevents
the three consumers (menu filter + two config surfaces) from drifting.

Workflow to add a new per-industry rule:

1. Open `apps/frontend/src/app/shared/constants/industry-modules.constant.ts`.
2. Add the module key string to the relevant industry's array in `INDUSTRY_HIDDEN_MODULES`.
3. (Optional) Verify the module key already exists in `APP_MODULES.STORE_ADMIN` — the rule is meaningless otherwise because the key would not be in any user config surface.
4. (Optional) Update `default-templates.seed.ts` if a fresh-store default should differ from `'retail'`.

No other code change is required. `getModulesHiddenByIndustries` re-computes, the
three consumers pick it up, and the gating rule in the two config surfaces disables
matching toggles automatically.

## API Surface Touch Points

The industry field is plumbed through these touch points (no behavior change to the
existing panel-UI API; only additive):

| Touch point | File | Notes |
| --- | --- | --- |
| `StoreIndustry` TS enum | `apps/backend/src/domains/store/stores/dto/index.ts` | Mirrors the Prisma enum exactly |
| `CreateStoreDto.industries` | `apps/backend/src/domains/store/stores/dto/index.ts` | `@IsOptional() @IsArray() @ArrayMinSize(1) @IsEnum(StoreIndustry, { each: true })` |
| `UpdateStoreDto.industries` | same | Same validators |
| `StoreQueryDto.industries` | same | Same validators + `@Transform(({ value }) => Array.isArray(value) ? value : [value])` **before** validation so single-value query params parse |
| `GeneralSettings.industries` (backend) | `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts` | Mirror of column |
| `GeneralSettingsDto.industries` | `apps/backend/src/domains/store/settings/dto/settings-schemas.dto.ts` | Validators |
| `getDefaultStoreSettings().general.industries` | `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts` | `['retail']` |
| `settings.service.ts` sync block | `apps/backend/src/domains/store/settings/settings.service.ts:397-453` | Mirrors `dto.general.industries` → `stores.industries` (`if (industries !== undefined) storeUpdateData.industries = industries;`) |
| `SetupStoreWizardDto.industries` | `apps/backend/src/domains/organization/onboarding/dto/setup-store-wizard.dto.ts` | Onboarding path |
| Onboarding create path | `apps/backend/src/domains/organization/onboarding/onboarding-wizard.service.ts` (~719) | Passes `industries ?? ['retail']` through `storeBootstrapHelper.createStoreWithDefaultLocation()` |
| Onboarding update path | same (~662) | Sets `industries` when provided |
| `INDUSTRY_HIDDEN_MODULES` constant | `apps/frontend/src/app/shared/constants/industry-modules.constant.ts` | **New** — single source for industry rules |
| `getModulesHiddenByIndustries(industries)` | same | OR semantics helper |
| `auth.selectors.ts` — `selectUserIndustries` | `apps/frontend/src/app/core/store/auth/auth.selectors.ts` | Snapshot fallback selector |
| `auth.facade.ts` — `userIndustries$` / `userIndustries` signal | `apps/frontend/src/app/core/store/auth/auth.facade.ts` | Snapshot fallback signal (with `initialValue` for `toSignal`) |
| `general-settings-form` (Frontend) | `apps/frontend/src/app/private/modules/store/settings/general/components/general-settings-form/general-settings-form.component.ts` | "Tipos de Negocio" multi-select + "Módulos de la Tienda" card |
| Super-admin / org-admin store modals | `apps/frontend/src/app/private/modules/super-admin/stores/components/store-create-modal.component.ts` (+ edit + org-admin create) | `industries` control via `app-multi-selector` |

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

> **Note:** the store panel UI is **set** (not read) by the user-settings pipeline. It is persisted in `store_settings` and shipped to the frontend as part of the `storeSettings` payload; the per-user `mergePanelUiSoft` does **not** intersect with it. The intersection happens client-side in `MenuFilterService` (see Triple-Crossing Order).

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

> **Industry / store-panel-UI note:** the "Nuevo" badge reflects defaults vs the user's
> `panel_ui_seen_keys`. Industry and store-panel-UI layers do **not** contribute
> "Nuevo" badges — a key is either surfaced in `new_keys` for a privileged role or it
> isn't. The store card never marks a key as new for the user; it only toggles.

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
5. `MenuFilterService.filterMenuItems(...)` filters layout menu items recursively. Internally it now applies the **triple crossing** (industry ∩ store panel UI ∩ user panel UI) before the existing `storeTypeHiddenModules` filter.
6. The sidebar does NOT call `isNewModule(label)` for badges anymore. Discovery hints are rendered by the user-dropdown banner and the Settings → General "Módulos del Panel" section.
7. `authFacade.markPanelUiSeen(key, app_type)` is dispatched from those surfaces (e.g. when the user toggles a module ON in Settings), never from a sidebar click.
8. The "Módulos de la Tienda" card in `/admin/settings/general` ships `panel_ui` to the backend via the existing settings PUT; industry-disallowed toggles render disabled.

Frontend key files:

- `apps/frontend/src/app/core/store/auth/auth.selectors.ts`
- `apps/frontend/src/app/core/store/auth/auth.facade.ts`
- `apps/frontend/src/app/core/services/menu-filter.service.ts`
- `apps/frontend/src/app/shared/constants/app-modules.constant.ts`
- `apps/frontend/src/app/shared/constants/industry-modules.constant.ts` (**new**)
- `apps/frontend/src/app/private/layouts/store-admin/store-admin-layout.component.ts`
- `apps/frontend/src/app/private/layouts/organization-admin/organization-admin-layout.component.ts`
- `apps/frontend/src/app/shared/components/settings-modal/settings-modal.component.ts`
- `apps/frontend/src/app/private/modules/store/settings/users/components/store-user-edit-modal.component.ts`
- `apps/frontend/src/app/private/modules/store/settings/general/components/general-settings-form/general-settings-form.component.ts`

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
- **Inlining per-industry rules in components**: an inline `if (industry === 'restaurant') hide(...)` in `MenuFilterService` or one of the config surfaces causes the three consumers to drift. The single source of truth is `INDUSTRY_HIDDEN_MODULES` in `apps/frontend/src/app/shared/constants/industry-modules.constant.ts`.
- **Hiding industry/store-disallowed toggles instead of disabling them**: silent hiding confuses users — they wonder where the module went. Render the toggle **disabled with a reason badge** ("Industria" / "Tienda") so the user understands the ceiling.
- **Saving the disabled toggles as `false`**: when the user saves a panel-UI edit, disabled toggles must be **excluded from the diff**. Forcing them to `false` would overwrite the user's previous preference and lose it permanently if the industry later re-allows the module.
- **Empty `panel_ui` settings JSON treated as "hide everything"**: absent = allowed is the contract. The runtime must use `panel_ui?.[key] === false` (strict) — never `!panel_ui?.[key]` (which would treat absent as hidden).
- **Empty industries array as a "no-op"**: the DTO's `@ArrayMinSize(1)` is the safety net. An empty array is an explicit 400 — never a silent no-op, or the JSON/column will drift.
- **Forgetting the `['retail']` defensive fallback**: if both `storeSettings.general.industries` and `authFacade.userIndustries()` are empty, the runtime must default to `['retail']` so the filter is always defined.

## Visibility vs Authorization

| Concern | System |
| --- | --- |
| Hide/show sidebar item | `panel_ui` (per-user + per-store), `INDUSTRY_HIDDEN_MODULES`, `module_flows`, store type, operating scope, fiscal scope, subscription filtering |
| Allow/deny API operation | `PermissionsGuard`, roles, auth guards, subscription guards |
| Show a module but block writes | Feature gate/subscription guard |
| Grant permission but hide menu | Possible; visibility and authorization are separate |

The industry / store panel UI layers are **visibility only**. They do not authorize any
backend operation — APIs remain protected by permissions/guards as today. The runtime
client-side filter plus the gated config UIs are sufficient; the plan explicitly
rejected a backend clamp of user `panel_ui` writes against the industry ceiling
(unnecessary because visibility != authorization).

## Related Skills

- `vendix-permissions` - Backend authorization (visibility is NOT authorization)
- `vendix-settings-system` - Settings persistence and defaults (`store_settings`, `organization_settings`)
- `vendix-subscription-gate` - Subscription-based feature access
- `vendix-frontend-routing` - Lazy routes for modules
- `vendix-operating-scope` - STORE vs ORGANIZATION visibility
- `vendix-fiscal-scope` - Fiscal scope filtering
- `how-to-plan` - Must record the two Critical Plan Decisions whenever a plan introduces a module or submodule
- `planning/industry-field-foundation-plan.md` - Foundation plan that introduced the industry dimension + store panel UI ceiling (Step 11 = this skill update)
