---
name: vendix-panel-ui
description: >
  Panel UI module visibility system: backend defaults, NgRx selectors, MenuFilterService, and sidebar filtering.
  Trigger: When adding new modules to the sidebar, configuring panel_ui visibility, or understanding how menu filtering works.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Adding modules or submodules to the sidebar"
    - "Configuring panel_ui visibility"
    - "Working with MenuFilterService or menu filtering"
    - "Adding new menu items to admin layouts"
---

# Vendix Panel UI System

> **Module visibility control** — Determines which modules and submodules appear in the sidebar for each app type (ORG_ADMIN, STORE_ADMIN, STORE_ECOMMERCE).

---

## When to Use

- Adding a **new module** to any admin sidebar
- Adding a **submodule** (child menu item) under an existing parent
- Configuring which modules are **visible/hidden** per app type
- Understanding how `panel_ui` flows from **backend → NgRx → sidebar**
- Debugging why a menu item **does not appear** in the sidebar
- Modifying `MenuFilterService` label-to-key mappings

---

## Architecture Overview

```
 BACKEND (Sources of Truth)                    FRONTEND (Consumption)
 ┌──────────────────────────────┐              ┌──────────────────────────────────┐
 │                              │              │                                  │
 │  1. default_templates (DB)   │              │  NgRx Auth Store                 │
 │     ↕ seeded by              │              │  ┌────────────────────────────┐  │
 │  2. default-templates.seed   │   Login      │  │ auth.reducer               │  │
 │                              │  Response    │  │   state.user_settings      │  │
 │  3. DefaultPanelUIService    │ ──────────►  │  │     .config.panel_ui       │  │
 │     (5-min cached DB read    │              │  │     .app_type              │  │
 │      + hardcoded fallback)   │              │  └────────────┬───────────────┘  │
 │                              │              │               │                  │
 │  4. default-store-settings   │              │  Auth Selectors                  │
 │     (store-level panel_ui)   │              │  ┌────────────▼───────────────┐  │
 │                              │              │  │ selectPanelUiConfig        │  │
 └──────────────────────────────┘              │  │   → selectCurrentAppPanelUi│  │
                                               │  │     → selectVisibleModules │  │
                                               │  └────────────┬───────────────┘  │
                                               │               │                  │
                                               │  AuthFacade                      │
                                               │  ┌────────────▼───────────────┐  │
                                               │  │ getVisibleModules$()       │  │
                                               │  │ isModuleVisible(key)       │  │
                                               │  └────────────┬───────────────┘  │
                                               │               │                  │
                                               │  MenuFilterService               │
                                               │  ┌────────────▼───────────────┐  │
                                               │  │ moduleKeyMap (label → key) │  │
                                               │  │ filterMenuItems(items$)    │  │
                                               │  │ filterItemsRecursive()     │  │
                                               │  └────────────┬───────────────┘  │
                                               │               │                  │
                                               │  Layout Components               │
                                               │  ┌────────────▼───────────────┐  │
                                               │  │ store-admin-layout         │  │
                                               │  │ org-admin-layout           │  │
                                               │  │   allMenuItems → filtered  │  │
                                               │  └────────────────────────────┘  │
                                               └──────────────────────────────────┘
```

---

## Data Structure

The `panel_ui` object is a **flat map** of `module_key: boolean` nested under each app type:

```typescript
// user_settings.config shape:
{
  panel_ui: {
    ORG_ADMIN: {
      dashboard: true,
      stores: true,
      users: true,
      domains: true,
      audit: true,
      settings: true,
      analytics: true,
      reports: true,
      inventory: true,
      billing: true,
      ecommerce: true,
      orders: true,
      expenses: true
    },
    STORE_ADMIN: {
      dashboard: true,
      pos: true,
      products: true,
      ecommerce: true,
      // Parent + children use "parent_child" convention:
      orders: true,
      orders_sales: true,
      orders_purchase_orders: true,
      inventory: true,
      inventory_pop: true,
      inventory_adjustments: true,
      inventory_locations: true,
      inventory_suppliers: true,
      customers: true,
      customers_all: true,
      customers_reviews: true,
      marketing: true,
      marketing_promotions: true,
      marketing_coupons: true,
      analytics: true,
      analytics_sales: true,
      analytics_traffic: true,
      analytics_performance: true,
      expenses: true,
      expenses_overview: true,
      expenses_all: true,
      expenses_create: true,
      expenses_categories: true,
      expenses_reports: true,
      settings: true,
      settings_general: true,
      settings_payments: true,
      settings_appearance: true,
      settings_security: true,
      settings_domains: true,
      settings_shipping: true,
      settings_legal_documents: true,
      settings_support: true
    },
    STORE_ECOMMERCE: {
      profile: true,
      history: true,
      dashboard: true,
      favorites: true,
      orders: true,
      settings: true
    },
    VENDIX_LANDING: {}
  },
  preferences: {
    language: 'es',
    theme: 'default'
  }
}
```

**Key convention:** Submodule keys use `parent_child` format (e.g., `orders_sales`, `inventory_pop`, `settings_domains`).

---

## Backend: Sources of Truth

There are **3 backend places** where panel_ui defaults are defined. All three must stay in sync. Additionally, **2 frontend modals** must also include the key (see "Step-by-Step" sections).

### 1. DefaultPanelUIService (hardcoded fallback)

**File:** `apps/backend/src/common/services/default-panel-ui.service.ts`

- **Primary source:** Queries `default_templates` table (name = `user_settings_default`) with a **5-minute TTL cache**.
- **Fallback:** If DB query fails, uses `PANEL_UI_FALLBACK` — a hardcoded `Record<string, Record<string, boolean>>`.
- **Returns:** `{ panel_ui: { ORG_ADMIN, STORE_ADMIN, STORE_ECOMMERCE, VENDIX_LANDING }, preferences }` for ALL app types regardless of input.

### 2. Default Templates Seed

**File:** `apps/backend/prisma/seeds/default-templates.seed.ts`

- Seeds the `default_templates` table via upsert (keyed on `template_name`).
- Template name: `user_settings_default`, configuration_type: `user_settings`.
- `template_data` contains the identical panel_ui structure as the hardcoded fallback.
- This is the **editable-from-SuperAdmin** source of truth stored in DB.

### 3. Default Store Settings

**File:** `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts`

- A **separate** panel_ui that lives inside `store_settings` (not `user_settings`).
- Only covers `STORE_ADMIN` and `STORE_ECOMMERCE` (no ORG_ADMIN or VENDIX_LANDING).
- Controls store-level module gating independently of user config.
- Note: May have slight differences from user defaults (e.g., `settings_support` absent here).

---

## Backend → Frontend Flow

### On User Creation
1. `AuthService` or `UsersService` calls `DefaultPanelUIService.generatePanelUI(app_type)`.
2. Result stored in `user_settings.config` (JSON column) + `user_settings.app_type` (direct column).
3. panel_ui is generated **once** at creation and persisted — not regenerated on each login.

### On Login
1. Backend reads `user_settings` from DB (does NOT regenerate).
2. Login response includes:
   - `user_settings: { id, user_id, app_type, config: { panel_ui, preferences } }`
   - `store_settings: { ..., panel_ui: { STORE_ADMIN, STORE_ECOMMERCE } }` (separate)
3. Frontend auth effects store both in NgRx `auth` state.

### On Environment Switch
1. `EnvironmentSwitchService` only updates `user_settings.app_type` column.
2. `config.panel_ui` is **NOT regenerated** — the full panel_ui for all app types is always stored.
3. Frontend picks the correct sub-object via `selectCurrentAppPanelUi` using the new `app_type`.

---

## Frontend: Selector Chain

**File:** `apps/frontend/src/app/core/store/auth/auth.selectors.ts`

```
selectUserSettings
  └─► selectPanelUiConfig     = userSettings?.config?.panel_ui || {}
        └─► selectSelectedAppType    = userSettings?.app_type || 'ORG_ADMIN'
              └─► selectCurrentAppPanelUi = panelUi[appType] || panelUi || {}
                    ├─► selectVisibleModules   = Object.entries().filter(visible === true).map(key)
                    └─► selectIsModuleVisible(key) = panelUi[key] === true
```

**AuthFacade** exposes:
- `getVisibleModules$()` — Observable of `string[]` (keys where value is `true`)
- `isModuleVisible(moduleKey)` — Synchronous boolean check

---

## Frontend: MenuFilterService

**File:** `apps/frontend/src/app/core/services/menu-filter.service.ts`

### moduleKeyMap

Maps **Spanish menu labels** to **English panel_ui keys**:

```typescript
private moduleKeyMap: Record<string, string | string[]> = {
  // ORG_ADMIN
  'Panel Principal': 'dashboard',
  'Tiendas': 'stores',
  'Usuarios': 'users',
  'Auditoría y Cumplimiento': 'audit',

  // STORE_ADMIN - standalone
  'Punto de Venta': 'pos',
  'Productos': 'products',
  'E-commerce': 'ecommerce',

  // STORE_ADMIN - parents + submodules
  'Órdenes': 'orders',
  'Ordenes de Venta': 'orders_sales',
  'Ordenes de Compra': 'orders_purchase_orders',
  // ... (inventory, customers, marketing, analytics, expenses, settings)

  // Multi-context: supports both ORG_ADMIN and STORE_ADMIN
  'Dominios': ['domains', 'settings_domains'],  // array = OR logic
};
```

**When a label maps to an array**, the item is visible if **ANY** key is enabled (OR logic).

### filterItemsRecursive — 3 Cases

1. **`alwaysVisible: true`** — Skip panel_ui filtering entirely. Used for dynamic items (e.g., store list).
2. **Has moduleKeyMap entry** — Check if the mapped key(s) are in `visibleModules`. Hidden if not found.
3. **No mapping, no alwaysVisible** — Only show if it has visible children (defensive fallback).

### Usage in Layouts

```typescript
// In layout component:
this.filteredMenuItems$ = this.menuFilterService.filterMenuItems(this.allMenuItems);
// Template: <app-sidebar [menuItems]="filteredMenuItems$ | async">
```

---

## Frontend: Layout Integration

### Store Admin Layout

**File:** `apps/frontend/src/app/private/layouts/store-admin/store-admin-layout.component.ts`

- Defines `allMenuItems: MenuItem[]` with all possible STORE_ADMIN menu items.
- Each `MenuItem` has: `label`, `icon`, `routerLink`, `children?`, `alwaysVisible?`.
- Passes `allMenuItems` through `MenuFilterService.filterMenuItems()`.

### Organization Admin Layout

**File:** `apps/frontend/src/app/private/layouts/organization-admin/organization-admin-layout.component.ts`

- Same pattern for ORG_ADMIN menu items.

---

## Step-by-Step: Add a New Module

### Backend (3 files)

**1.** `apps/backend/src/common/services/default-panel-ui.service.ts`
   - Add `new_module: true` in `PANEL_UI_FALLBACK` under the target app_type (e.g., `STORE_ADMIN`).

**2.** `apps/backend/prisma/seeds/default-templates.seed.ts`
   - Add `new_module: true` in `template_data.panel_ui` under the same app_type.

**3.** `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts`
   - Add `new_module: true` if the module is for `STORE_ADMIN` or `STORE_ECOMMERCE`.
   - Skip this file if the module is only for `ORG_ADMIN`.

### Frontend (5 files)

**4.** `apps/frontend/src/app/core/services/menu-filter.service.ts`
   - Add `'Label en Español': 'new_module'` in `moduleKeyMap`.

**5.** `apps/frontend/src/app/shared/components/settings-modal/settings-modal.component.ts`
   - Add the new module in `APP_MODULES` constant so it appears as a **toggle** in the user-facing settings modal.
   - For standalone modules: add a new entry with `key`, `label`, `description`.
   - For submodules: add as a child in the parent's `children[]` array.
   - **Critical:** Without this, existing users cannot enable/disable the module from their settings.

**6.** `apps/frontend/src/app/private/modules/organization/users/components/user-config-modal.component.ts`
   - Add `new_module: true` (or `false`) in `defaultPanelUi` under the target app_type.
   - This controls the **default state** when an admin creates/configures a user from the organization panel.

**7.** Layout component (choose one):
   - `store-admin-layout.component.ts` — for STORE_ADMIN modules
   - `organization-admin-layout.component.ts` — for ORG_ADMIN modules
   - Add a new `MenuItem` in `allMenuItems` with `label`, `icon`, `routerLink`.

**8.** Configure the lazy-loaded route in the corresponding routing file.

### Verification

- Existing users will already have `panel_ui` stored — the new key won't exist for them.
- The settings modal (file 5) allows existing users to **see and toggle** the new module even if their stored config doesn't include it yet.
- New users get the updated defaults automatically.
- To update existing users in bulk, run a migration or use the admin panel to update `user_settings.config`.

---

## Step-by-Step: Add a Submodule

Submodules are children of an existing parent module.

### Key Convention

Use `parent_child` for the key:
- `orders_sales`, `orders_purchase_orders`
- `inventory_pop`, `inventory_adjustments`
- `settings_general`, `settings_payments`

### Backend (3 files)

Same as "Add a New Module" but add the `parent_child: true` key alongside the existing parent key.

### Frontend (5 files)

**1.** `menu-filter.service.ts` — Add both parent label and child label mappings:
```typescript
'Parent Label': 'parent',           // if not already present
'New Child Label': 'parent_child',
```

**2.** `settings-modal.component.ts` — Add the submodule in the parent's `children[]` inside `APP_MODULES`:
```typescript
{
  key: 'parent',
  label: 'Parent',
  description: '...',
  isParent: true,
  children: [
    // existing children...
    { key: 'parent_child', label: 'New Child Label', description: '...' },
  ],
}
```

**3.** `user-config-modal.component.ts` — Add `parent_child: true` in `defaultPanelUi` under the target app_type.

**4.** Layout component — Add as `children[]` of the parent `MenuItem`:
```typescript
{
  label: 'Parent',
  icon: 'parent-icon',
  children: [
    { label: 'Existing Child', icon: 'icon', routerLink: '/existing' },
    { label: 'New Child Label', icon: 'new-icon', routerLink: '/new-child' },
  ]
}
```

**5.** Configure the child route as a lazy-loaded sub-route.

---

## Key Files Reference

| Purpose | File Path |
|---------|-----------|
| Fallback hardcoded defaults | `apps/backend/src/common/services/default-panel-ui.service.ts` |
| Seed defaults (DB) | `apps/backend/prisma/seeds/default-templates.seed.ts` |
| Store-level defaults | `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts` |
| Auth service (login response) | `apps/backend/src/domains/auth/auth.service.ts` |
| Environment switch | `apps/backend/src/domains/auth/environment-switch.service.ts` |
| User config DTO | `apps/backend/src/domains/organization/users/dto/user-config.dto.ts` |
| Users service (update config) | `apps/backend/src/domains/organization/users/users.service.ts` |
| Auth selectors (NgRx) | `apps/frontend/src/app/core/store/auth/auth.selectors.ts` |
| Auth facade | `apps/frontend/src/app/core/store/auth/auth.facade.ts` |
| MenuFilterService | `apps/frontend/src/app/core/services/menu-filter.service.ts` |
| Settings modal (user toggles) | `apps/frontend/src/app/shared/components/settings-modal/settings-modal.component.ts` |
| User config modal (admin) | `apps/frontend/src/app/private/modules/organization/users/components/user-config-modal.component.ts` |
| MenuItem interface | `apps/frontend/src/app/shared/components/sidebar/sidebar.component.ts` |
| Store admin layout | `apps/frontend/src/app/private/layouts/store-admin/store-admin-layout.component.ts` |
| Org admin layout | `apps/frontend/src/app/private/layouts/organization-admin/organization-admin-layout.component.ts` |

---

## Common Pitfalls

1. **Forgetting one of the 3 backend files** — All three must stay in sync or new users vs existing users will have different defaults.
2. **Missing moduleKeyMap entry** — The module key exists in panel_ui but the sidebar item has no mapping, so the fallback logic (Case 3) applies: item only shows if it has visible children.
3. **Existing users don't get new keys** — panel_ui is generated at user creation. You must update existing users' configs via migration or admin panel.
4. **Label mismatch** — moduleKeyMap matches on the exact Spanish label string. A typo means the item falls through to Case 3.
5. **Array keys for multi-context labels** — If a label appears in multiple app types with different keys (like "Dominios"), use an array: `['domains', 'settings_domains']`.
6. **Forgetting settings-modal or user-config-modal** — The new key must also be added to `APP_MODULES` in `settings-modal.component.ts` (so users can toggle it) and to `defaultPanelUi` in `user-config-modal.component.ts` (so admins see it when configuring users). Without these, existing users have no way to enable the new module from the UI.
