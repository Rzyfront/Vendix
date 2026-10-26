# Panel UI — frontend surfaces, diagnosis, catalog

## Key files

- `apps/frontend/src/app/core/services/menu-filter.service.ts` — `filterMenuItems`, `moduleKeyMap`, `storeTypeHiddenModules`, `diagnose()` / `diagnoseModule()`, `passesAuthorizationGates()`, `authorizationGates$`
- `apps/frontend/src/app/shared/constants/industry-modules.constant.ts` — `STORE_INDUSTRIES`, `StoreIndustry`, `INDUSTRY_HIDDEN_MODULES`, `getModulesHiddenByIndustries()`
- `apps/frontend/src/app/shared/constants/app-modules.constant.ts` — `APP_MODULES` (editable catalog)
- `apps/frontend/src/app/shared/constants/store-module-catalog.constant.ts` — `STORE_MODULE_BY_KEY`, `resolveStoreModule()`
- `apps/frontend/src/app/shared/components/panel-ui-modules-editor/panel-ui-modules-editor.component.ts`
- `apps/frontend/src/app/core/store/auth/auth.selectors.ts` / `auth.facade.ts` (`selectUserIndustries`, `userIndustries$` / `userIndustries`, `markPanelUiSeen`)
- Layouts: `apps/frontend/src/app/private/layouts/store-admin/store-admin-layout.component.ts`, `.../organization-admin/organization-admin-layout.component.ts`
- `apps/frontend/src/app/core/models/store-settings.interface.ts` (`GeneralSettings.industries`)

## Industry snapshot fallback

```ts
const industries = storeSettings?.general?.industries?.length
  ? storeSettings.general.industries
  : (loginIndustries?.length ? loginIndustries : ['retail']);
```

JWT is NOT extended with `industries`; settings is the source of truth. Industries (`STORE_INDUSTRIES`): `retail | restaurant | manufacturing | service | gym | construction`. Current map (inverse gating: a suite is visible only for its industry): `restaurant_ops` → restaurant; `memberships` → gym; `orders_reservations` → service; `orders_contracts` → construction; dispatch suite (`dispatch`, `orders_dispatch_*`, `dispatch_fleet`, `settings_shipping`, `analytics_dispatch`, `reports_dispatch`) → retail only. Read the constant for the live list.

## Diagnosis — `diagnose()`

`isMenuItemVisible()` = `this.diagnose(menuItem).visible`. Returns `{ visible, blockedBy, detail (Spanish), fixPath }`; `blockedBy` ∈ `fiscal_scope | fiscal_area | operating_scope | industry | store_panel_ui | store_type | user_panel_ui | subscription | permission | empty`. First blocker in chain order wins (root cause).

`diagnoseModule(key, menuItems?)` gives the same verdict by key; pass the menu tree when available (without it only key-driven layers run). Backs Vexi `ui_why_hidden`.

Authorization prefilters (entries without own key: `/admin/settings/users`, `/admin/pqrs`, `/admin/settings/vexi`) live in `passesAuthorizationGates()`, shared by `filterMenuItems` and `diagnose`. Their inputs must be in `authorizationGates$`.

Unmapped leaf (no `moduleKeyMap`, no children) is dropped by `filterItemsRecursive` while `diagnose()` reports it visible. Intentionally key-less entries: `alwaysVisible: true` + gate in `passesAuthorizationGates()` (as `/admin/settings/vexi`).

## Module catalog — key, not label

The sidebar joins `allMenuItems` ↔ `APP_MODULES` ↔ `PANEL_UI_FALLBACK` by Spanish label, and labels collide ("Inventario", "Productos", "Clientes", "Reseñas", "Compras", "Ventas", "Resumen", "Financiero", "Contabilidad", "Nómina"). `resolveStoreModule()`: exact key → exact label (single hit) → single substring hit → `null` on ambiguity (intended).

Drift tests: `menu-filter.service.spec.ts` (`MODULE_ROUTES` ⊆ `APP_MODULES` both ways); `apps/backend/src/common/services/default-panel-ui.service.spec.ts` parses backend fallback + frontend constant with `readFileSync` (backend/frontend drift).

## `app-panel-ui-modules-editor` (single render source)

Storage-agnostic module tree (grouping, "Herramientas Directas", parent/child cascade, gating, search, "Nuevo"). Never re-implement the tree.

| Member | Meaning |
| --- | --- |
| `appType` (required) | `APP_MODULES[appType]` to render |
| `value` (required) | Resolved `Record<string,boolean>`; absent / `true` = allowed |
| `hiddenByIndustry` / `hiddenByStore` | Gated keys → disabled + badge "Industria"/"Tienda" |
| `newKeys` | Keys with "Nuevo" |
| `searchable`, `parentSync`, `readOnly` | UI toggles |
| `valueChange` (output) | Full map for the `app_type`, omitting gated keys |

| Consumer | Storage | Save semantics |
| --- | --- | --- |
| `general-settings-form` (store, `/admin/settings/general`, card "Módulos de la Tienda") | mirror of `panelUi` input | emits `{ STORE_ADMIN: { key:false } }` (only OFF keys) |
| `shared/components/settings-modal` (own config) | `FormGroup` `panel_ui.{appType}.{key}` | `buildPanelUiDiff` excludes gated |
| `private/modules/store/settings/users/components/store-user-edit-modal` | signal `localPanelUI` | `buildPanelUIDiff` vs `originalPanelUI`, excludes gated |
| `private/modules/organization/users/components/user-config-modal` | `localPanelUi` per `app_type` | full nested map; `STORE_ECOMMERCE`/`VENDIX_LANDING` on "Avanzado (JSON)" |

Gating applies to `STORE_ADMIN` only (industries are store-scoped; `ORG_ADMIN` untouched).

## Store-level panel UI

`store_settings.settings.panel_ui` reuses `PanelUISettings` (same nested shape, usually only `STORE_ADMIN`). Absent = allowed; `false` = hidden store-wide; `true` = no-op. Persisted via existing settings PUT. Capped by industry: industry-hidden toggles are disabled in the store card.
