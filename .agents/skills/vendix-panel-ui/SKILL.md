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
| `user_settings.config.panel_ui` | Main per-user module visibility map |
| `user_settings.app_type` | Selects the active app panel map |
| `DefaultPanelUIService` | New user defaults from `default_templates.user_settings_default` with 5-minute cache and fallback |
| `store_settings.module_flows` | Force-hides operational modules like accounting/payroll/invoicing when flows are disabled |
| `MenuFilterService` | Applies panel keys, store type rules, and subscription feature requirements |
| `APP_MODULES` constant | Editable module catalog for settings UI |

## Core Rules

- `panel_ui` is UI visibility only. Protect APIs with permissions/guards.
- New user defaults come from `DefaultPanelUIService`, not from the sidebar components.
- Existing users may not have new keys until their config is updated or they toggle modules in UI.
- Menu filtering is label-driven through `MenuFilterService.moduleKeyMap`; label mismatches hide items unexpectedly.
- Array mappings in `moduleKeyMap` mean OR logic across multiple keys.
- Store type, `module_flows`, and subscription gates may hide a module even when `panel_ui[key] === true`.

## Real Frontend Flow

1. Auth state stores `user_settings` from login/session restore.
2. Selectors read `user_settings.config.panel_ui`.
3. Selectors choose the active map using `user_settings.app_type`.
4. `selectVisibleModules` returns keys whose value is `true`, after module-flow adjustments.
5. `MenuFilterService.filterMenuItems(...)` filters layout menu items recursively.

Key files:

- `apps/frontend/src/app/core/store/auth/auth.selectors.ts`
- `apps/frontend/src/app/core/store/auth/auth.facade.ts`
- `apps/frontend/src/app/core/services/menu-filter.service.ts`
- `apps/frontend/src/app/shared/constants/app-modules.constant.ts`
- `apps/frontend/src/app/private/layouts/store-admin/store-admin-layout.component.ts`
- `apps/frontend/src/app/private/layouts/organization-admin/organization-admin-layout.component.ts`

## Adding A Module Or Submodule

1. Add the key to `DefaultPanelUIService` fallback and `default_templates.user_settings_default` when it should exist for new users.
2. Add the key to `APP_MODULES` so users/admins can toggle it.
3. Add or verify the Spanish label mapping in `MenuFilterService.moduleKeyMap`.
4. Add the menu item in the owning layout.
5. Add the lazy route for the module.
6. Add backend permissions/guards separately if the feature exposes protected APIs.

Submodule keys should follow `parent_child`, for example `orders_sales` or `settings_domains`, unless existing code already uses a different key.

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
