# Plan: `industries` Multi-Select Foundation + Store Panel UI Ceiling (Restaurant / Manufacturing / Service Readiness)

## Context

Vendix today differentiates stores by **modality** (`store_type`: `physical | online | hybrid | popup | kiosko`) and uses that value to drive sidebar visibility. The user wants Vendix to also support restaurant workflows (recipe-driven menu, kitchen display, table ops) and other elaboration-based businesses (manufacturing, services, dark kitchens, coffee shops, hotels). A single-value `industry` field breaks real-world tenants: a hotel sells lodging (service) + food (restaurant) + souvenirs (retail). The fix is a **multi-select** `industries: StoreIndustry[]` field, persisted on `stores.industries` and mirrored through `store_settings.settings.general.industries`, with OR semantics in visibility rules (a module is available if AT LEAST ONE of the store's industries allows it). Default is `['retail']` so existing tenants are unchanged.

**Revision 2 extends the scope with three user requirements:**

1. **Onboarding**: the store-setup wizard step configures `store_type` today; it must also configure `industries` at the same point.
2. **Store-level panel UI config**: users have a per-user `panel_ui` (edited in the user-config modal and the user-edit modal). There must be a **store-level panel UI** that crosses with the per-user one according to industry. Decision confirmed by the user: **derived from industries AND editable by the owner** (`store_settings.settings.panel_ui`, interface `PanelUISettings` already exists unused). Crossing semantics: **industry ∩ store ∩ user** — if the industry hides a module, neither the store config nor the user config can enable it, and the per-user config UIs must not allow toggling it.
3. **Skill update**: at the end, update the `vendix-panel-ui` skill to document the new visibility dimension.

Per-industry module rules are intentionally **empty** in this plan (foundation only — recipes, KDS, and concrete per-industry rules live in follow-up plans), but all plumbing (constant, crossing logic, UI gating) is wired and observable.

**Panel UI Critical Plan Decisions** (per `vendix-panel-ui` skill): this plan adds **no new module key** to `PANEL_UI_FALLBACK` or `APP_MODULES` (the new "Módulos de la Tienda" card lives inside the existing `settings_general` page). Therefore `default_visible_for_privileged_users` and `show_new_badge` are **N/A**. If a follow-up plan turns the store modules card into its own submodule key, that plan must record both decisions.

## General Objective

Vendix stores carry an `industries` array (multi-select) orthogonal to `store_type`, configurable from onboarding, Settings, and super-admin / org-admin store forms, persisted on `stores.industries` with default `['retail']`. A store-level panel UI config (`store_settings.settings.panel_ui`) exists, editable by the owner and capped by the industry rules. Effective module visibility = **industry availability ∩ store panel UI ∩ user panel UI** (plus existing store_type / scope / subscription filters), and the per-user panel UI config surfaces respect the same ceiling.

## Specific Objectives

1. `industry_enum` exists in Postgres with values `retail`, `restaurant`, `manufacturing`, `service`; `stores.industries` column exists as `industry_enum[]` with default `ARRAY['retail']::industry_enum[]`; migration is idempotent, hand-written, applied with `migrate deploy` (NOT `migrate dev`), and safe on populated DBs.
2. Backend TS enum `StoreIndustry` exported from the stores DTO module; `industries?: StoreIndustry[]` on `CreateStoreDto` and `UpdateStoreDto` validated with `@IsArray() @ArrayMinSize(1) @IsEnum(StoreIndustry, { each: true })`; `StoreQueryDto.industries` additionally has a `@Transform` that wraps single query values into an array. Invalid / mixed / empty values return 400.
3. `store_settings.settings.general.industries` exists; `getDefaultStoreSettings()` returns `industries: ['retail']`; `settings.service.ts` syncs incoming `industries` to `stores.industries` (same pattern as `store_type`). Empty array is rejected with 400 at the DTO layer (`@ArrayMinSize(1)`) — no silent no-op, no drift between the settings JSON and the column.
4. The onboarding store-setup step configures `industries` (multi-card selection, min 1, default `['retail']`) and `SetupStoreWizardDto` + `onboarding-wizard.service.ts` persist it on both the create and update paths.
5. Frontend `general-settings-form` shows a multi-select "Tipos de Negocio" control (reusing the existing shared `app-multi-selector` CVA component) below "Tipo de Tienda"; super-admin `store-create-modal`, super-admin `store-edit-modal`, and org-admin `store-create-modal` include `industries` in form and payload.
6. A shared frontend constant `INDUSTRY_HIDDEN_MODULES` (empty per-industry arrays in this plan) plus helper `getModulesHiddenByIndustries(industries)` (OR semantics) is the single source for industry availability, consumed by `MenuFilterService` and both panel-UI config surfaces.
7. `store_settings.settings.panel_ui` (existing `PanelUISettings` interface) is accepted by the settings DTO/endpoint, editable by the owner from a new "Módulos de la Tienda" card in Settings → General; toggles for industry-hidden modules render disabled. Absent key = allowed; `false` = hidden for the whole store.
8. `MenuFilterService` applies the triple crossing: a module is visible only if the industry allows it AND the store panel UI does not disable it AND the user panel UI shows it (existing store_type / operating-scope / fiscal filters unchanged). `authFacade.userIndustries$` signal + `selectUserIndustries` selector exist for the snapshot fallback; JWT payload is NOT extended.
9. The per-user panel UI surfaces — `settings-modal.component.ts` ("Módulos del Panel") and `store-user-edit-modal.component.ts` (pestaña "Modulos") — render industry/store-disallowed modules as disabled with a reason badge, so a user toggle can never enable a module above the ceiling.
10. The `vendix-panel-ui` skill documents the new industry + store-level dimensions and the crossing semantics.

## Approach Chosen

A new Prisma enum `industry_enum` plus a `stores.industries industry_enum[] @default([retail])` array column, mirrored into `store_settings.settings.general.industries` (dual persistence, same pattern as `store_type`). The multi-select UI reuses the existing shared `app-multi-selector` component (CVA, signals — verified to exist at `apps/frontend/src/app/shared/components/multi-selector/`). Onboarding mirrors the existing `store_type` card pattern with multi-toggle cards.

Visibility becomes a three-layer AND: **industry availability** (computed from `INDUSTRY_HIDDEN_MODULES` with OR semantics across the store's industries — map intentionally empty in this plan), **store panel UI** (`store_settings.settings.panel_ui.STORE_ADMIN`, absent = allowed, `false` = hidden store-wide, editable by owner but capped by industry), and **user panel UI** (existing system, untouched persistence). The two per-user config surfaces gate their toggles by the first two layers. `MenuFilterService` reads all three (it already receives `storeSettings$`). The snapshot signal pair `userIndustries$` / `userIndustries` is added symmetric to `userStoreType$`.

## Alternatives Considered

- **Single-value `industry` (enum, not array)**: rejected — real tenants are multi-industry (hotel = service + restaurant + retail). Forcing a single value locks paying customers out of features.
- **Multiple boolean columns (`is_restaurant`, ...)**: rejected — unscalable, unqueryable, hard to map to a rules map keyed by industry.
- **JSON column with array of strings** (no enum): rejected — loses DB-level validation; the enum array gives type safety and queryability (`WHERE 'restaurant' = ANY(industries)`).
- **Reuse `store_type_enum` adding industry values**: rejected — confuses modality with industry and explodes combinatorially.
- **Store panel UI derived-only (not editable)**: rejected by the user — the owner must be able to restrict modules store-wide beyond what the industry implies. The existing unused `PanelUISettings` interface is reused instead of inventing a new shape.
- **"Empty industries array = no-op" on PUT** (rev 1): rejected — it creates drift between `store_settings.general.industries` (would store `[]`) and `stores.industries` (would keep the old value). Replaced by `@ArrayMinSize(1)` → explicit 400.
- **Backend clamp of user `panel_ui` writes against the industry ceiling**: not included — `panel_ui` is UI visibility only (not authorization, per `vendix-panel-ui`); the runtime filter in `MenuFilterService` plus the gated config UIs are sufficient. APIs remain protected by permissions/guards as today.

## Critical Files

- `apps/backend/prisma/schema.prisma` — add `industry_enum`; add `industries industry_enum[] @default([retail])` on `stores`.
- `apps/backend/prisma/migrations/<timestamp>_add_industries_array/migration.sql` — hand-written idempotent SQL, applied with `migrate deploy`.
- `apps/backend/src/domains/store/stores/dto/index.ts` — `StoreIndustry` enum; `industries` on `CreateStoreDto`, `UpdateStoreDto`, `StoreQueryDto` (with `@Transform`).
- `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts` — add `industries?: StoreIndustry[]` to `GeneralSettings`; `PanelUISettings` (lines ~219-224) and `panel_ui?: PanelUISettings` (~303) already exist.
- `apps/backend/src/domains/store/settings/dto/settings-schemas.dto.ts` — `industries` on `GeneralSettingsDto`; ensure `panel_ui` section is accepted/validated (add `PanelUISettingsDto` if missing).
- `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts` — `industries: ['retail']` in `general` defaults.
- `apps/backend/src/domains/store/settings/settings.service.ts` — extend the `dto.general` sync block (~397-453) with `industries`.
- `apps/backend/src/domains/organization/onboarding/dto/setup-store-wizard.dto.ts` — add `industries?: StoreIndustry[]`.
- `apps/backend/src/domains/organization/onboarding/onboarding-wizard.service.ts` — persist `industries` on create (~719, via `storeBootstrapHelper.createStoreWithDefaultLocation`) and update (~662) paths.
- `apps/frontend/src/app/shared/components/onboarding-modal/steps/store-setup-step.component.ts` — multi-card "Industria(s) del negocio" section below the store-type cards (~492-580) + form control + payload.
- `apps/frontend/src/app/core/models/store-settings.interface.ts` — mirror `industries` (and `panel_ui` if missing).
- `apps/frontend/src/app/private/modules/store/settings/general/components/general-settings-form/general-settings-form.component.ts` / `.html` — "Tipos de Negocio" multi-select + new "Módulos de la Tienda" card.
- `apps/frontend/src/app/private/modules/super-admin/stores/components/store-create-modal.component.ts` — `industries` control + payload.
- `apps/frontend/src/app/private/modules/super-admin/stores/components/store-edit-modal.component.ts` — `industries` control + payload.
- `apps/frontend/src/app/private/modules/organization/stores/components/store-create-modal/store-create-modal.component.ts` — `industries` control + payload.
- `apps/frontend/src/app/shared/constants/industry-modules.constant.ts` — **new**: `INDUSTRY_HIDDEN_MODULES` + `getModulesHiddenByIndustries()`.
- `apps/frontend/src/app/core/services/menu-filter.service.ts` — triple-crossing filter logic.
- `apps/frontend/src/app/core/store/auth/auth.selectors.ts` — `selectUserIndustries`.
- `apps/frontend/src/app/core/store/auth/auth.facade.ts` — `userIndustries$` + `userIndustries` signal.
- `apps/frontend/src/app/shared/components/settings-modal/settings-modal.component.ts` — gate "Módulos del Panel" toggles by industry ∩ store ceiling.
- `apps/frontend/src/app/private/modules/store/settings/users/components/store-user-edit-modal.component.ts` — gate pestaña "Modulos" toggles by industry ∩ store ceiling.
- `apps/backend/prisma/seeds/default-templates.seed.ts` — seed hygiene for `general.industries`.
- `.claude/skills/vendix-panel-ui/SKILL.md` (+ source under `skills/` if applicable) — document new dimensions.

## Reusable Assets

- `apps/backend/src/domains/store/settings/settings.service.ts:397-453` — verified sync pattern for `name | logo_url | store_type | timezone` from `dto.general` to `stores`. Mirrored for `industries`; for arrays the assignment is direct (`storeUpdateData.industries = industries`), Prisma serializes to a Postgres array.
- `apps/backend/src/domains/store/stores/dto/index.ts:19-25` — `StoreType` TS enum (verified). Mirrored for `StoreIndustry`.
- `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts:219-224, 303` — **`PanelUISettings` interface and `panel_ui?` field already exist, currently unused** (verified). Reused as-is for the store-level config; no new shape invented.
- `apps/frontend/src/app/shared/components/multi-selector/multi-selector.component.ts` — **existing shared `app-multi-selector` CVA component (verified)**. Reused for all multi-select industry controls; no new component is created.
- `apps/frontend/src/app/core/services/menu-filter.service.ts:30-35, 198-206` — `storeTypeHiddenModules` map and `effectiveModules` filter (verified). Pattern mirrored for the industry + store layers; the service already receives `storeSettings$` in its `combineLatest`.
- `apps/frontend/src/app/core/store/auth/auth.facade.ts:95-96, 192` and `auth.selectors.ts:229-231` — `userStoreType$` / signal / `selectUserStoreType` (verified). Mirrored for industries.
- `apps/frontend/src/app/shared/components/onboarding-modal/steps/store-setup-step.component.ts:492-580` — store-type clickable cards (verified). The industry section copies the card pattern with multi-toggle behavior.
- `apps/backend/src/domains/organization/onboarding/onboarding-wizard.service.ts:626-798` — `setupStore()` create/update branching (verified): update path ~662, create path ~719 via `storeBootstrapHelper.createStoreWithDefaultLocation()`.
- `apps/frontend/src/app/shared/components/settings-modal/settings-modal.component.ts:459-524` — APP_MODULES iteration + per-key control paths (verified). The gating hook filters/disables at this level.
- `apps/frontend/src/app/private/modules/store/settings/users/components/store-user-edit-modal.component.ts:703-733` — APP_MODULES filtering for the "Modulos" tab (verified). Same gating hook.
- `apps/backend/src/domains/store/store-users/store-user-management.service.ts:399-430` — `updatePanelUI()` persistence for per-user config (context; untouched by this plan).

## Steps

1. **Add `industry_enum` and `stores.industries` array column (hand-written idempotent migration, `migrate deploy`)**
   Skills: `vendix-prisma-schema`, `vendix-prisma-migrations`, `vendix-prisma`
   Resources: hand-written `migration.sql`; `npx prisma migrate deploy` (workspace command); Prisma client regeneration **inside the Docker backend container** + container restart; manual `psql` introspection.
   Business decision: 4-value closed enum (`retail`, `restaurant`, `manufacturing`, `service`). Column default `ARRAY['retail']::industry_enum[]` backfills existing rows automatically. No auto-classification of existing tenants.
   ⚠️ Workflow constraint (project-specific): `schema.prisma` is desynced from the DB in this repo — **NEVER `migrate dev`** (it would generate a giant drift migration). Write the migration folder/SQL by hand, apply with `migrate deploy`, then update `schema.prisma` to match. There are also uncommitted `schema.prisma` changes on `dev` right now; do not mix them into this migration.
   Why: First step; everything else assumes the column and enum exist.
   Output: `enum industry_enum { retail restaurant manufacturing service }` in `schema.prisma`; `industries industry_enum[] @default([retail])` on `stores`. Migration `<timestamp>_add_industries_array/migration.sql` with idempotent SQL: `CREATE TYPE` guarded by `pg_type` check; `ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "industries" "industry_enum"[] NOT NULL DEFAULT ARRAY['retail']::"industry_enum"[];`. No destructive statements (`-- DATA IMPACT: additive only`).
   Verification: `npx prisma migrate status` clean. `SELECT enum_range(NULL::industry_enum)` → `{retail,restaurant,manufacturing,service}`. `SELECT industries FROM stores LIMIT 5` → `{'retail'}` everywhere. Prisma client regenerated in-container, backend container healthy after restart (`buildcheck-dev`).

2. **Add `StoreIndustry` TS enum and DTO fields (array, each-validated, query-transform)**
   Skills: `vendix-backend-api`, `vendix-validation`, `vendix-naming-conventions`
   Resources: `npm run build -w apps/backend`; Bruno smoke requests.
   Business decision: TS enum mirrors the Prisma enum. Body DTOs: `@IsOptional() @IsArray() @ArrayMinSize(1) @IsEnum(StoreIndustry, { each: true })`. Query DTO additionally needs `@Transform(({ value }) => (Array.isArray(value) ? value : [value]))` **before** validation — query params arrive as plain strings for single values, so bare `@IsArray()` would 400 `?industries=restaurant`. Filtering uses Prisma's `has` operator.
   Why: After Step 1 the column exists but no API accepts it.
   Output: `StoreIndustry` enum in `apps/backend/src/domains/store/stores/dto/index.ts`; `industries` on `CreateStoreDto`, `UpdateStoreDto`, `StoreQueryDto` (query version with the transform).
   Verification: build exits 0. `POST /superadmin/stores` with `industries: ['retail','restaurant']` → 201 echoing the array. `['bogus']` → 400; `['retail','bogus']` → 400; `[]` → 400. `GET /superadmin/stores?industries=restaurant` (single value) and `?industries=restaurant&industries=service` (repeated) both filter correctly.

3. **Mirror `industries` through `store_settings` (interface, DTO, defaults, sync — no empty no-op)**
   Skills: `vendix-settings-system`, `vendix-backend-api`, `vendix-validation`
   Resources: `npm run build -w apps/backend`; default-store-settings spec; Bruno `bruno/store/settings-industries.bru`.
   Business decision: `industries` lives in `store_settings.settings.general` (same place as `store_type`). Sync follows the existing pattern. Empty arrays are **rejected at the DTO** (`@ArrayMinSize(1)`) — an explicit 400 instead of rev-1's silent no-op, eliminating JSON/column drift by construction.
   Why: Without this the field is not settable from the primary user-facing settings page.
   Output: `industries?: StoreIndustry[]` on `GeneralSettings` (backend interface) and on `GeneralSettingsDto` with full validators; `industries: ['retail']` in `getDefaultStoreSettings().general`; `settings.service.ts` destructuring extended with `industries` + `if (industries !== undefined) storeUpdateData.industries = industries;`.
   Verification: build 0; spec passes. Bruno: `PUT /store/settings/general` with `['retail','restaurant']` → 200, `GET` echoes it, `SELECT industries FROM stores WHERE id=$storeId` matches. `PUT` with `[]` → 400 (value unchanged in both persistences). `PUT` with `['retail']` reverts.

4. **Onboarding — configure `industries` in the store-setup wizard step**
   Skills: `vendix-backend-api`, `vendix-validation`, `vendix-zoneless-signals`, `vendix-angular-forms`
   Resources: `npm run build -w apps/backend`; `npm run build:prod -w apps/frontend`; manual E2E of the onboarding wizard on a fresh org.
   Business decision: The industry selection lives in the same wizard step as `store_type` (`store-setup-step`), rendered as **multi-toggle cards** mirroring the existing store-type card pattern (`:492-580`) — visual consistency, no new component. Default `['retail']`, minimum 1 enforced client-side; the DTO's `@ArrayMinSize(1)` is the safety net. Card copy explains multi-select ("puedes marcar varias").
   Why: User requirement — "set industries at onboarding" matters for a SaaS; otherwise every multi-industry owner needs a second trip to Settings.
   Output: `industries?: StoreIndustry[]` (`@IsOptional() @IsArray() @ArrayMinSize(1) @IsEnum(..., { each: true })`) on `SetupStoreWizardDto`. `onboarding-wizard.service.ts`: create path passes `industries: setupStoreDto.industries ?? ['retail']` through `storeBootstrapHelper.createStoreWithDefaultLocation()` (helper signature extended); update path (~662) sets `industries` when provided. Frontend `store-setup-step.component.ts`: `industries` form control (`string[]`, default `['retail']`), multi-toggle card section below store type, payload includes the array.
   Verification: backend + frontend builds 0. E2E: new org → wizard → mark "Restaurante" + "Retail" → finish; `SELECT industries FROM stores WHERE organization_id=$org` → `{'retail','restaurant'}`. Re-running setup-store (update path) with different industries updates the row. Omitting the field defaults to `{'retail'}`.

5. **Frontend settings form — "Tipos de Negocio" multi-select (reuse `app-multi-selector`)**
   Skills: `vendix-zoneless-signals`, `vendix-angular-forms`, `vendix-settings-system`
   Resources: `npm run build:prod -w apps/frontend`; `npm run zoneless:audit`; manual UI at `/admin/settings/general`.
   Business decision: The control sits in the same `Información Básica` card as "Tipo de Tienda", immediately below it. **Reuses the existing shared `app-multi-selector` CVA component (verified to exist)** — no new component, removing rev-1's conditional branch. Sibling info block explains OR semantics. Min 1 client-side.
   Why: Primary user-facing surface.
   Output: `industryOptions: SelectorOption[]`; `industries: FormControl<string[]>` default `['retail']`; `<app-multi-selector formControlName="industries" ...>` + info block; `industries?: StoreIndustry[]` added to the frontend `GeneralSettings` mirror in `apps/frontend/src/app/core/models/store-settings.interface.ts`.
   Verification: build 0; zoneless audit clean. UI: add "Restaurante", save, refresh → `['retail','restaurant']` persists; visible from super-admin too; a fresh store shows `['retail']`.

6. **Super-admin / org-admin store forms — `industries` control**
   Skills: `vendix-zoneless-signals`, `vendix-angular-forms`, `vendix-backend-api`
   Resources: `npm run build:prod -w apps/frontend`; manual UI smoke.
   Business decision: Both creation paths and the super-admin edit path allow setting `industries`. Form default `['retail']`. Edit `populateForm()` uses `store.industries?.length ? store.industries : ['retail']`.
   Why: Multi-industry owners should not need a post-creation second step.
   Output: `industries` control (via `app-multi-selector`) + payload mapping in the three modals listed in Critical Files.
   Verification: build 0. Super-admin creates store with "Restaurante" + "Servicios" → `SELECT industries` → `{'restaurant','service'}`. Org-admin same flow. Super-admin edit to "Retail" only → column updates.

7. **Shared industry-rules constant + `MenuFilterService` triple crossing + snapshot signal**
   Skills: `vendix-panel-ui`, `vendix-zoneless-signals`
   Resources: `npm run build:prod -w apps/frontend`; `npm run zoneless:audit`.
   Business decision: The per-industry rules live in a **new shared constant** `apps/frontend/src/app/shared/constants/industry-modules.constant.ts` (not inside `MenuFilterService`) because three consumers need it: the menu filter and both panel-UI config surfaces (Step 9). It exports `INDUSTRY_HIDDEN_MODULES: Record<StoreIndustry, string[]>` (all arrays **empty** in this plan) and `getModulesHiddenByIndustries(industries: string[]): string[]` implementing OR semantics: a module is hidden only if hidden for EVERY industry of the store (set-intersection of the per-industry hidden lists). Store layer: `storeSettings.panel_ui?.STORE_ADMIN?.[key] === false` hides store-wide; absent/`true` = allowed. Defensive empty industries falls back to `['retail']`. JWT is NOT extended; settings is the source of truth, `userIndustries$` is the snapshot fallback.
   Why: Locks the wiring so follow-up plans only fill the map; a single source prevents the three consumers from drifting.
   Output: the new constant file; `menu-filter.service.ts` reads `const industries = storeSettings?.general?.industries || loginIndustries || ['retail'];`, computes `hiddenByIndustries` via the helper, computes `hiddenByStorePanel` from `storeSettings?.panel_ui?.STORE_ADMIN`, and extends the existing `effectiveModules` chain (after `hiddenByStoreType`) with both exclusions, commented. `auth.selectors.ts`: `selectUserIndustries` reading `store?.industries`; `auth.facade.ts`: `userIndustries$` + `userIndustries` signal (with `initialValue`).
   Verification: build 0; zoneless audit clean. Sidebar byte-identical to today for `['retail']` and `['retail','restaurant']` stores (rules map empty). `authFacade.userIndustries()` returns the array in devtools. **Implementation check**: confirm the login response's `store` object includes the new `industries` column (if the auth service builds it with an explicit `select`, add the field); the `['retail']` fallback covers the gap meanwhile.

8. **Store-level panel UI — backend acceptance + "Módulos de la Tienda" card in Settings → General**
   Skills: `vendix-panel-ui`, `vendix-settings-system`, `vendix-validation`, `vendix-zoneless-signals`, `vendix-angular-forms`
   Resources: `npm run build -w apps/backend`; `npm run build:prod -w apps/frontend`; Bruno `PUT /store/settings` with `panel_ui`; manual UI.
   Business decision: The store config reuses the existing (unused) `PanelUISettings` interface at `store-settings.interface.ts:219-224` / field `panel_ui` (~303). Semantics: **absent = allowed, `false` = hidden for the whole store** — so existing tenants (no `panel_ui` in settings) are unchanged. The editing UI is a new "Módulos de la Tienda" card in `/admin/settings/general` below "Tipos de Negocio" (inside the existing `settings_general` page → **no new panel_ui key, Critical Plan Decisions N/A**), listing `APP_MODULES.STORE_ADMIN` with toggles; modules hidden by the store's industries render **disabled with a "No disponible para tu industria" hint** (once rules exist; with the empty map everything is enabled). Editable only where the page is already restricted (owner/admin via existing settings access).
   Why: User requirement — the owner must be able to restrict modules store-wide; industry caps what the owner can enable.
   Output: `settings-schemas.dto.ts` accepts/validates `panel_ui` (add a `PanelUISettingsDto` — `Record<string, boolean>` per app_type — if the update DTO doesn't already pass it through; verify the settings deep-merge persists it). Frontend: mirror `panel_ui` on the frontend `StoreSettings` interface if missing; new card component/section in `general-settings-form` rendering `APP_MODULES.STORE_ADMIN` with toggles, gated by `getModulesHiddenByIndustries(...)`; save path sends `panel_ui` through the existing settings PUT.
   Verification: backend + frontend builds 0. Bruno: `PUT /store/settings` with `panel_ui: { STORE_ADMIN: { marketing: false } }` → 200; `GET /store/settings` echoes it. UI: owner turns "Marketing" off in "Módulos de la Tienda", saves → sidebar hides Marketing for **every** store user (including those whose user panel_ui has `marketing: true`); turning it back on restores visibility per-user config.

9. **Gate the per-user panel UI config surfaces by the industry ∩ store ceiling**
   Skills: `vendix-panel-ui`, `vendix-zoneless-signals`
   Resources: `npm run build:prod -w apps/frontend`; manual UI on `/admin/settings/users` (both annotated surfaces).
   Business decision: In both surfaces — `settings-modal.component.ts` ("Módulos del Panel", user edits own config, APP_MODULES iteration at ~459-524) and `store-user-edit-modal.component.ts` (pestaña "Modulos", admin edits another user, ~703-733) — modules disallowed by industry or by the store panel UI render **disabled (not hidden) with a reason badge** ("Industria" / "Tienda"), so admins understand why a module cannot be enabled instead of wondering where it went. Disabled toggles are excluded from the save payload diff (their stored user value is preserved untouched — if the industry later re-allows the module, the user's previous preference resurfaces).
   Why: User requirement — "si la industria no permite ver un módulo, el usuario tampoco lo ve **ni lo puede configurar para verlo**".
   Output: both components consume `getModulesHiddenByIndustries(...)` + the store `panel_ui` map (from `authFacade.storeSettings` / the store-users service as appropriate) and disable matching toggles with the badge; only for `STORE_ADMIN` app_type maps (ORG_ADMIN is untouched — industries are store-scoped).
   Verification: build 0. With the empty rules map: both surfaces visually unchanged today. With store `panel_ui: { STORE_ADMIN: { marketing: false } }`: "Marketing" appears disabled with badge "Tienda" in both surfaces, cannot be toggled, and saving another module does not alter the stored user value for `marketing`. Sidebar agrees with Step 8's verification.

10. **Default-templates seed — keep `store_default_settings` in sync (hygiene only)**
    Skills: `vendix-prisma-seed`, `vendix-settings-system`
    Resources: targeted seed run in dev only (NEVER production).
    Business decision: Seed only the `store_settings.general` default block (`industries: ['retail']`). No `panel_ui` seeding — absent = allowed is the canonical default.
    Why: Avoid drift between hardcoded defaults and the seeded template.
    Output: `general.industries: ['retail']` in `apps/backend/prisma/seeds/default-templates.seed.ts` where a `general` block exists.
    Verification: after the targeted seed, `SELECT settings->'general'->'industries' FROM default_templates WHERE ...store_default_settings...` → `["retail"]`.

11. **Update the `vendix-panel-ui` skill (and sync)**
    Skills: `skill-creator`, `skill-sync`
    Resources: `./skills/setup.sh --sync` / `skills/skill-sync/assets/sync.sh` as applicable.
    Business decision: The skill's "Visibility Sources" table and "Core Rules" gain the two new dimensions: `stores.industries` + `INDUSTRY_HIDDEN_MODULES` (OR semantics, frontend constant) and `store_settings.settings.panel_ui` (store-wide ceiling, absent = allowed). Document the triple-crossing order (industry ∩ store ∩ user ∩ store_type/scope/subscription), the gating of both config surfaces (disabled + reason badge), and the rule that per-industry module rules belong in `industry-modules.constant.ts`, never inline in components.
    Why: User requirement; without it the next plan (which fills the rules map) lacks documented ground truth.
    Output: updated `SKILL.md` for `vendix-panel-ui` (source + `.claude/skills/` sync); AGENTS.md auto-invoke table regenerated only if triggers change.
    Verification: skill file reflects the new architecture; sync script run clean; no unrelated skill diffs.

## End-to-End Verification

1. **Migration & DB shape**: `migrate status` clean (deploy path, not dev); enum range correct; column default correct; existing rows backfilled `{'retail'}`; Prisma client regenerated in-container and backend healthy.
2. **Backend contract** (Bruno):
   - `GET /store/settings` → `general.industries === ['retail']` for a fresh store.
   - `PUT /store/settings/general` `['retail','restaurant']` → 200, echoed, column matches. `[]` → 400. `['bogus']` / mixed → 400.
   - `POST /superadmin/stores` with `['restaurant','service']` → 201 echoed; `GET ?industries=restaurant` (single and repeated param forms) filters.
   - Onboarding `POST /organization/onboarding-wizard/setup-store` with `industries` persists on create and update paths.
   - `PUT /store/settings` with `panel_ui.STORE_ADMIN.marketing=false` persists and is returned.
3. **Builds**: backend build 0; frontend `build:prod` 0; `zoneless:audit` no new violations.
4. **UI smoke**:
   - Onboarding wizard: industries cards, multi-select, persisted.
   - `/admin/settings/general`: "Tipos de Negocio" persists; "Módulos de la Tienda" card toggles store-wide visibility.
   - Super-admin / org-admin store modals: industries in create + edit.
   - `/admin/settings/users`: both annotated surfaces show disabled toggles + reason badge when store panel UI disables a module; saving preserves untouched user values.
   - Sidebar: byte-identical for existing tenants (empty rules map, no store panel_ui); hides modules store-wide when the owner disables them; `authFacade.userIndustries()` observable in devtools.
5. **Skill**: `vendix-panel-ui` documents the new dimensions; sync clean.

## Knowledge Gaps

None blocking. The industry rules map is intentionally empty — the follow-up plans (restaurant Operations / recipes, KDS, per-industry rules) will populate it and should propose a `vendix-store-industries` skill (or extend `vendix-panel-ui`) when real per-industry behavior lands. Step 11 already covers documenting the foundation in `vendix-panel-ui`.

## Approval Request

This plan (revision 2: + onboarding, + store panel UI ceiling editable by owner, + config-surface gating, + skill update, + rev-1 review corrections) is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
