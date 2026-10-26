# Panel UI — backend flow, "Nuevo" badge, backfill, industry plumbing

## Template resolution — `DefaultPanelUIService.getUnifiedTemplate()`

`apps/backend/src/common/services/default-panel-ui.service.ts`

1. Load `default_templates.user_settings_default` from DB.
2. Deep-merge `PANEL_UI_FALLBACK` per `app_type`: key present in DB → respect DB (including `false`); missing → take fallback value.
3. Cache merged template 5 min (`CACHE_TTL`).

Adding a key to `PANEL_UI_FALLBACK` is enough for privileged users in prod. Seed update is hygiene only.
`generatePanelUI(_app_type)` ignores its argument and always returns the full nested map.

## Per-user lazy soft merge (read path, no DB write)

`mergeUserConfigPanelUi(config, defaults, roles)` in `apps/backend/src/common/utils/panel-ui-merge.util.ts` (`mergePanelUiSoft`, internal `isLegacyFlatPanelUi`):

1. Load `user_settings`, roles, defaults (`generatePanelUI('')`).
2. Legacy flat shape (all top-level values booleans) → discarded as if no `panel_ui`.
3. Roles in `PRIVILEGED_ROLE_NAMES` → fill `undefined` keys from defaults per `app_type`. Else return as stored.
4. Compute `new_keys`.
5. Return in-memory config.

Call sites: `apps/backend/src/domains/auth/auth.service.ts` (`login()`, `getSettings()`, `registerOwner()`, `registerCustomer()`), `apps/backend/src/domains/auth/environment-switch.service.ts` (`userSettingsForResponse`).

`PRIVILEGED_ROLE_NAMES = { owner, admin, super_admin }` + `hasPrivilegedRole(roles)` in `apps/backend/src/common/utils/privileged-roles.util.ts`. Single source; `ELIGIBLE_ROLES` in `superadmin/users/users.service.ts` reuses it via `Array.from(PRIVILEGED_ROLE_NAMES)`.

Store panel UI is NOT intersected in the backend; it ships in `storeSettings` and the intersection happens in `MenuFilterService`.

## "Nuevo" badge

- `new_keys[app_type] = defaults[app_type] keys not in user.panel_ui_seen_keys[app_type]`; privileged roles only; returned in `user_settings.config.new_keys`.
- Mark seen: `POST /auth/panel-ui/mark-seen` body `{ key, app_type }` (`auth.controller.ts`, `dto/mark-panel-ui-seen.dto.ts`); appends to `panel_ui_seen_keys[app_type]`. Any authenticated user.
- Surfaces: user dropdown banner ("Tienes N módulos nuevos disponibles…"), count badge on "Configuración" link, Settings → General → "Módulos del Panel" rows. Toggle/save calls `authFacade.markPanelUiSeen(key, app_type)`.
- Never in the sidebar (removed as intrusive). `MenuFilterService.isNewModule(label)` / `getNewKeyForLabel(label)` remain exported for opt-in surfaces.
- Industry / store panel UI layers never contribute "Nuevo".
- Users without `panel_ui_seen_keys` see all keys as new once; self-heals as they activate them.
- Badge missing? Check (a) merged template includes key, (b) user is privileged, (c) 5-min cache after redeploy.

## Persisted backfill (super_admin)

`apps/backend/src/domains/superadmin/users/users.controller.ts` / `users.service.ts:syncPanelUI`, guard `@Roles(UserRole.SUPER_ADMIN)`:

| Endpoint | Purpose |
| --- | --- |
| `GET /superadmin/users/panel-ui-preview` | Dry-run: eligible users, missing keys per `app_type` |
| `POST /superadmin/users/sync-panel-ui` | Body `{ user_ids?, app_types?, strategy?: 'merge' \| 'replace' }`. `merge` (default) fills missing, keeps `false`; `replace` overwrites the `app_type` map |

Eligible users = privileged roles only. Flat legacy `panel_ui` in DB → fix with `strategy: 'replace'`.

## Industry plumbing (backend)

| Touch point | File |
| --- | --- |
| Column `stores.industries industry_enum[] @default([retail])` | `apps/backend/prisma/schema.prisma` |
| `StoreIndustry` const + `CreateStoreDto` / `UpdateStoreDto` / `StoreQueryDto.industries` | `apps/backend/src/domains/store/stores/dto/index.ts` (also `domains/organization/stores/dto/index.ts`) |
| `GeneralSettings.industries` / `PanelUISettings` | `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts` |
| `GeneralSettingsDto.industries` | `apps/backend/src/domains/store/settings/dto/settings-schemas.dto.ts` |
| Default `['retail']` | `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts` |
| Sync `general.industries` → `stores.industries` | `apps/backend/src/domains/store/settings/settings.service.ts` |
| Onboarding (`industries ?? ['retail']`) | `apps/backend/src/domains/organization/onboarding/dto/setup-store-wizard.dto.ts`, `onboarding-wizard.service.ts` |

Validators: body `@IsOptional() @IsArray() @ArrayMinSize(1) @IsEnum(StoreIndustry, { each: true })` — `ArrayMinSize(1)` is load-bearing (empty array = explicit 400, never silent no-op / JSON-column drift). Query: `@Transform(({ value }) => Array.isArray(value) ? value : [value])` before validation so `?industries=restaurant` parses.

Some industry suites also have backend enforcement (e.g. `ConstructionIndustryGuard`, 403 `CONTRACT_INDUSTRY_001`); `INDUSTRY_HIDDEN_MODULES` itself is UX only.
