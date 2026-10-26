---
name: vendix-panel-ui
description: >
  Panel UI module visibility: industry rules (INDUSTRY_HIDDEN_MODULES), store/user panel_ui, MenuFilterService, sidebar filtering. Trigger: adding sidebar modules, panel_ui config, debugging why a module is hidden (visibility vs permissions).
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.6"
  scope: [root]
  auto_invoke:
    - "Adding modules or submodules to the sidebar"
    - "Configuring panel_ui visibility"
    - "Working with MenuFilterService or menu filtering"
    - "Adding new menu items to admin layouts"
    - "Editing industry rules in INDUSTRY_HIDDEN_MODULES"
    - "Adding or editing per-industry module rules"
    - "Explaining why a module is not visible to a user"
    - "Adding a menu entry to the store module catalog"
---

# Vendix Panel UI

`panel_ui` is UI visibility only, never authorization. Protect APIs with `PermissionsGuard` / `@Permissions` / subscription guards (`vendix-permissions`, `vendix-subscription-gate`).

Detail (read on demand): `references/backend-flow.md` (template merge, lazy soft merge, "Nuevo" badge, super_admin backfill, industry DTO plumbing) and `references/frontend-surfaces.md` (key files, `diagnose()`, module catalog, `app-panel-ui-modules-editor` contract and consumers).

## Mandatory plan decisions (new module/submodule key)

The plan must state, with a 1–2 line justification each; otherwise block and ask. PRs adding a key to `PANEL_UI_FALLBACK` without them are rejected.

1. `default_visible_for_privileged_users` (`true`/`false`) = the fallback value. `true` for features useful to all; `false` for experimental / super_admin-only.
2. `show_new_badge` (`yes`/`no`, default `yes`): surfaces in user dropdown banner + Settings → General → "Módulos del Panel". The sidebar never renders "Nuevo".

Sub-cards inside an existing page (e.g. "Módulos de la Tienda" in `settings_general`) add no key → N/A.

## Filter chain (`MenuFilterService`, AND; a later step never widens)

1. Industry — `getModulesHiddenByIndustries(industries)`: hidden only if hidden for **every** store industry (set-intersection). Industries fallback: `storeSettings.general.industries` → `authFacade.userIndustries()` → `['retail']`.
2. Store panel UI — `storeSettings.panel_ui.STORE_ADMIN[key] === false` (strict; absent = allowed, never `!value`).
3. User panel UI — `user_settings.config.panel_ui[app_type][key] === true`.
4. `store_type` (`storeTypeHiddenModules`).
5. `module_flows` (accounting / payroll / invoicing).
6. Operating / fiscal scope (`vendix-operating-scope`, `vendix-fiscal-scope`).
7. Subscription gates (`vendix-subscription-gate`).

Owner bypass: `authFacade.isOwner()` skips step 3 (owner sees every module regardless of own `panel_ui`), mirrored in `panelUiGuard` and `firstActiveModuleRoute`.

Direct URL: `panelUiGuard` (`core/guards/panel-ui.guard.ts`, in `store_admin.routes.ts` `canActivate`/`canActivateChild` after `AuthGuard`) maps URL → keys with `resolveKeysForRoute()` and redirects hidden modules (user panel UI or industry) to `firstActiveModuleRoute()` with a toast. `PANEL_UI_TERMINAL_ROUTE` (`/admin/settings/general`, owner) and `PANEL_UI_NO_ACCESS_ROUTE` (`/admin/no-access`) always pass to avoid loops. Still UX, not authorization.

Any new hiding rule goes inside `diagnose()` (first blocker wins; backs Vexi `ui_why_hidden`), never as a separate `if` in a consumer. Authorization prefilters go in `passesAuthorizationGates()` and their inputs in `authorizationGates$`.

## Core rules

- Canonical shape is nested by `app_type` (`ORG_ADMIN`, `STORE_ADMIN`, `STORE_ECOMMERCE`, `VENDIX_LANDING`). Flat legacy shape is discarded on read; never write it.
- Defaults: `DefaultPanelUIService` = DB template deep-merged with `PANEL_UI_FALLBACK` (5-min cache). Adding a key to the fallback is enough; no seed/migration/backfill for privileged users.
- Privileged roles (`PRIVILEGED_ROLE_NAMES` in `privileged-roles.util.ts`: owner, admin, super_admin) get defaults filled into `undefined` keys at read time; `false` is always respected. Other roles get `panel_ui` as stored; admin curates them or super_admin uses `POST /superadmin/users/sync-panel-ui`. Any role list must import `PRIVILEGED_ROLE_NAMES`.
- Menu filtering is label-driven via `moduleKeyMap` (array = OR). Labels collide: register new entries by key in `store-module-catalog.constant.ts`; `resolveStoreModule()` returns `null` on ambiguity by design.
- An unmapped leaf with no children is silently dropped. Key-less entries: `alwaysVisible: true` + gate in `passesAuthorizationGates()`.
- Module tree UI exists only in `app-panel-ui-modules-editor`; consumers own persistence.

## Industry rules (single source)

All per-industry rules live in `apps/frontend/src/app/shared/constants/industry-modules.constant.ts` (`INDUSTRY_HIDDEN_MODULES`). Never inline in `MenuFilterService`, `settings-modal`, `store-user-edit-modal` or any component.

To add one: add the key to the relevant industries' arrays (inverse gating = list it in every industry except the owner one); verify the key exists in `APP_MODULES.STORE_ADMIN`. Nothing else changes. Industries enum (`StoreIndustry`, Postgres `industry_enum[]`, default `['retail']`) is additive only; DTOs keep `@ArrayMinSize(1)`.

## Gating of config surfaces (`STORE_ADMIN`)

For keys hidden by industry or by store panel UI: render the toggle **disabled** (not hidden) with badge "Industria" (precedence) or "Tienda", and **exclude it from the save diff** so the stored user value survives if the ceiling is lifted. The store card ("Módulos de la Tienda") disables industry-hidden toggles and saves only OFF keys.

## Checklist — add a module/submodule

1. Record both plan decisions.
2. Add key to `PANEL_UI_FALLBACK` (`apps/backend/src/common/services/default-panel-ui.service.ts`) under the right `app_type` with decision #1 value. Seed `default_templates.user_settings_default` optional.
3. Add key to `APP_MODULES` (`app-modules.constant.ts`) under the right parent (`children[]`). Without it admins cannot toggle it per user (#1 cause of "visible but not configurable").
4. Map the label in `MenuFilterService.moduleKeyMap` and register the key/route in `store-module-catalog.constant.ts` (also feeds `resolveKeysForRoute()` for `panelUiGuard`).
5. Add the menu item to the owning layout and the lazy route (`vendix-frontend-routing`).
6. Add backend permission + guard for its APIs.
7. If industry-specific, add the rule in `INDUSTRY_HIDDEN_MODULES`.

Submodule keys follow `parent_child` (`orders_sales`, `settings_domains`) unless existing code differs. Drift tests: `menu-filter.service.spec.ts`, `apps/backend/src/common/services/default-panel-ui.service.spec.ts`.

## Related

`vendix-permissions`, `vendix-settings-system`, `vendix-subscription-gate`, `vendix-frontend-routing`, `vendix-operating-scope`, `vendix-fiscal-scope`, `vendix-restaurant-ops`, `how-to-plan`.
