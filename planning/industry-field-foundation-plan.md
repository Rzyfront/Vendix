# Plan: `industry` Field Foundation (Restaurant / Manufacturing Readiness)

## Context

Vendix today differentiates stores by **modality** (`store_type`: `physical | online | hybrid | popup | kiosko`) and uses that value to drive sidebar visibility (e.g. `physical` hides `ecommerce`, `online` hides `pos` and `cash_registers`). The user wants Vendix to also support restaurant workflows (recipe-driven menu, kitchen display, table ops) and other elaboration-based businesses (manufacturing, dark kitchens, coffee shops). A restaurant can be `physical` (sala), `hybrid` (with delivery) or `popup` (food truck) — so the new dimension is **orthogonal to `store_type`**, not a value of it. This plan adds the foundation: a new column `industry` on `stores` with a closed enum (`retail | restaurant | manufacturing | service`), mirrored through the settings schema, defaults, sync service, frontend forms, and `MenuFilterService`. The plan does NOT build restaurant features (recipes, KDS) — those will be separate follow-up plans. The plumbing is locked in here so the next plans stay small and reviewable.

## General Objective

Vendix stores carry an `industry` dimension orthogonal to `store_type`, editable from Settings and from super-admin / org-admin store forms, persisted in `stores.industry`, and exposed to `MenuFilterService` so per-industry module rules can be added in follow-up plans without re-plumbing the filter.

## Specific Objectives

1. `industry_enum` exists in Postgres with values `retail`, `restaurant`, `manufacturing`, `service`; `stores.industry` column exists with default `retail`; migration is idempotent and safe to apply on populated DBs.
2. Backend `CreateStoreDto`, `UpdateStoreDto`, and `StoreQueryDto` accept and validate `industry` (TS enum `StoreIndustry`); invalid values return 400.
3. `store_settings.settings.general.industry` exists; `getDefaultStoreSettings()` returns `industry: 'retail'`; `settings.service.ts` syncs incoming `industry` to `stores.industry` (same pattern as `store_type`).
4. `settings-schemas.dto.ts` validates the field; interface `GeneralSettings` includes `industry?: StoreIndustry`.
5. Frontend `general-settings-form` shows a new "Tipo de Negocio" selector below "Tipo de Tienda", persists, reads back; the form's `general` payload type mirrors the backend interface.
6. Frontend super-admin `store-create-modal`, super-admin `store-edit-modal`, and org-admin `store-create-modal` include `industry` in the form and the submit payload.
7. `MenuFilterService` reads `industry` from settings (with snapshot fallback) and exposes an empty `industryHiddenModules` map ready for follow-up plans to populate.
8. `authFacade.userStoreIndustry$` signal and `selectUserStoreIndustry` selector exist to support the snapshot fallback path; JWT payload is NOT extended in this plan.

## Approach Chosen

Add a **new Prisma enum + column** (`industry_enum`, `stores.industry`) instead of overloading `store_type_enum` or stuffing the value into a JSON blob. The closed 4-value taxonomy matches the current target industries and keeps the column queryable (superadmin list filters, analytics, reports). Mirroring the field through `store_settings.settings.general` re-uses the existing save / sync / audit path. The frontend form is a near-mechanical copy of the `store_type` selector pattern, with a sibling info block explaining the consequence of each value. The `MenuFilterService` gets the new dimension wired in read-only mode (empty rules map), so the next plan can add rules without touching this code.

## Alternatives Considered

- **Reuse `store_type_enum` and add `restaurant`, `manufacturing`, `service` values**: rejected because it confuses modality with industry (a restaurant can be `physical`, `hybrid`, or `popup` — those are not industry values) and forces a combinatorial explosion when a food truck wants to use the restaurant feature (`popup_restaurant`?). Also breaks the existing `MenuFilterService.storeTypeHiddenModules` rules which assume the modality axis.
- **Store `industry` inside `store_settings.settings` JSON only, no column on `stores`**: rejected because it makes the field unqueryable from super-admin list filters / analytics / future reporting, and forces a JSON path for every read. The existing `store_type` already lives on both `stores.store_type` and `store_settings.general.store_type` precisely to keep it queryable — the same dual pattern is correct here.
- **Separate related table `store_industry_config` with one-to-one**: rejected as over-engineered for a 4-value closed taxonomy that needs no per-store custom attributes in this plan. If we later need per-industry configuration (e.g. recipe config, prep-time defaults), it can be added as a JSON column on `stores` or a separate `store_industry_settings` table at that time.

## Critical Files

- `apps/backend/prisma/schema.prisma` — add `industry_enum`; add `industry` column on `stores`.
- `apps/backend/prisma/migrations/<timestamp>_add_industry_enum/migration.sql` — new migration, idempotent SQL.
- `apps/backend/src/domains/store/stores/dto/index.ts` — add `StoreIndustry` TS enum; add `industry?: StoreIndustry` to `CreateStoreDto`, `UpdateStoreDto`, `StoreQueryDto`.
- `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts` — add `industry?: StoreIndustry` to `GeneralSettings`.
- `apps/backend/src/domains/store/settings/dto/settings-schemas.dto.ts` — add `industry?: StoreIndustry` + `@IsEnum` to `GeneralSettingsDto`.
- `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts` — add `industry: 'retail'` in `general` defaults.
- `apps/backend/src/domains/store/settings/settings.service.ts` — extend the `dto.general` block to sync `industry` to `stores.industry`.
- `apps/frontend/src/app/core/models/store-settings.interface.ts` — add `industry?: StoreIndustry` to `GeneralSettings` mirror type.
- `apps/frontend/src/app/private/modules/store/settings/general/components/general-settings-form/general-settings-form.component.ts` — add `industries: SelectorOption[]` and `industryControl`.
- `apps/frontend/src/app/private/modules/store/settings/general/components/general-settings-form/general-settings-form.component.html` — add `<app-selector>` for industry + sibling info block.
- `apps/frontend/src/app/private/modules/super-admin/stores/components/store-create-modal.component.ts` — add `industry` form control + payload mapping.
- `apps/frontend/src/app/private/modules/super-admin/stores/components/store-edit-modal.component.ts` — add `industry` form control + payload mapping.
- `apps/frontend/src/app/private/modules/organization/stores/components/store-create-modal/store-create-modal.component.ts` — add `industry` form control + payload mapping.
- `apps/frontend/src/app/core/services/menu-filter.service.ts` — add `industryHiddenModules` map + read `industry` from settings.
- `apps/frontend/src/app/core/store/auth/auth.selectors.ts` — add `selectUserStoreIndustry` reading `store?.industry`.
- `apps/frontend/src/app/core/store/auth/auth.facade.ts` — add `userStoreIndustry$` Observable and `userStoreIndustry` signal.

## Reusable Assets

- `apps/backend/src/domains/store/settings/settings.service.ts:397-453` — exact pattern for syncing `name | logo_url | store_type | timezone` from `dto.general` to `stores`. Mirrored for `industry` (Step 3).
- `apps/backend/src/domains/store/stores/dto/index.ts:19-25` — `StoreType` TS enum. Mirrored for `StoreIndustry` (Step 2).
- `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts:51-56` — `general` defaults shape. Added to (Step 3).
- `apps/frontend/src/app/private/modules/store/settings/general/components/general-settings-form/general-settings-form.component.ts:74-80` — `storeTypes: SelectorOption[]`. Mirrored for `industries` (Step 4).
- `apps/frontend/src/app/private/modules/store/settings/general/components/general-settings-form/general-settings-form.component.html:9-10` — `<app-selector>` for `storeTypeControl`. Mirrored for `industryControl` (Step 4).
- `apps/frontend/src/app/core/services/menu-filter.service.ts:30-35` and `200-207` — `storeTypeHiddenModules` map and the `effectiveModules` filter logic. Mirrored for `industry` (Step 6).
- `apps/frontend/src/app/core/store/auth/auth.facade.ts:95-96` and `192` — `userStoreType$` and `userStoreType` signal. Mirrored for `userStoreIndustry$` / `userStoreIndustry` (Step 6).
- `apps/frontend/src/app/core/store/auth/auth.selectors.ts:229-231` — `selectUserStoreType`. Mirrored for `selectUserStoreIndustry` (Step 6).

## Steps

1. **Add `industry_enum` enum and `stores.industry` column (idempotent migration)**
   Skills: `vendix-prisma-schema`, `vendix-prisma-migrations`, `vendix-prisma`
   Resources: `npm run db:migrate:dev -w apps/backend -- --name add_industry_enum`; `npm run prisma:generate -w apps/backend`; manual `psql` introspection of the new enum range and column default.
   Business decision: 4-value closed taxonomy (`retail | restaurant | manufacturing | service`) is the right granularity for Vendix's near-term target industries. Default `retail` matches the current user base; existing rows are backfilled to `retail` automatically by the column default. We do NOT attempt to auto-classify existing tenants.
   Why: First step. Every other step assumes the column and enum exist. Skipping this would force type errors across the DTO and frontend type updates.
   Output: `enum industry_enum { retail, restaurant, manufacturing, service }` in `schema.prisma`; `industry industry_enum @default(retail)` on the `stores` model. New migration `apps/backend/prisma/migrations/<timestamp>_add_industry_enum/migration.sql` with idempotent SQL using `CREATE TYPE` guarded by `pg_type` check, and `ADD COLUMN IF NOT EXISTS`.
   Verification: `npx prisma migrate status` shows the new migration applied with no drift. `SELECT enum_range(NULL::industry_enum)` returns `{retail,restaurant,manufacturing,service}`. `SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='stores' AND column_name='industry'` returns `industry_enum` / `retail`. `SELECT count(*) FROM stores WHERE industry IS NULL` returns `0` (all existing rows default-filled).

2. **Add `StoreIndustry` TS enum and DTO fields**
   Skills: `vendix-backend-api`, `vendix-validation`, `vendix-naming-conventions`
   Resources: `npm run build -w apps/backend`; manual curl with a smoke Bruno request.
   Business decision: TS enum mirrors the Prisma enum to keep the API contract in sync. The field is optional with no default at the DTO level (controller / service falls back to `retail` if undefined), so existing callers that do not send the field keep working unchanged. The DTO also accepts `industry` on the query DTO for superadmin list filter parity with `store_type`.
   Why: After Step 1 the column exists but no API accepts it. DTOs are required for both the next step (settings sync) and for the superadmin / org-admin store mutations in Step 5.
   Output: `StoreIndustry` enum exported from `apps/backend/src/domains/store/stores/dto/index.ts` with values matching the Prisma enum. `industry?: StoreIndustry` on `CreateStoreDto`, `UpdateStoreDto`, and `StoreQueryDto` (the latter with `@IsOptional() @IsEnum(StoreIndustry)`).
   Verification: `npm run build -w apps/backend` exits 0. Smoke request `POST /superadmin/stores` with `industry: 'restaurant'` returns 201 with `industry: 'restaurant'` echoed in the response body. Same request with `industry: 'bogus'` returns 400 with an `IsEnum` validation error. Request `GET /superadmin/stores?industry=restaurant` filters correctly.

3. **Mirror `industry` through `store_settings` (interface, DTO, defaults, sync)**
   Skills: `vendix-settings-system`, `vendix-backend-api`, `vendix-validation`
   Resources: `npm run build -w apps/backend`; `npm run test -w apps/backend -- --runInBand src/domains/store/settings/defaults/default-store-settings.spec.ts`; Bruno collection `bruno/store/settings-industry.bru`.
   Business decision: `industry` lives in `store_settings.settings.general` (same place as `store_type`) so it travels through the same save path, audit trail, and Settings UI; superadmin / org store mutations are only one entry point — the regular "Configuración → General" page is the main one. The sync to `stores.industry` follows the existing `if (store_type !== undefined) storeUpdateData.store_type = store_type;` pattern in `settings.service.ts`. We do NOT change the merge / migration machinery.
   Why: Without this, `industry` would only be settable from superadmin / org admin and not from the primary user-facing settings page.
   Output: `industry?: StoreIndustry` on the `GeneralSettings` interface in `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts`. `industry?: StoreIndustry` + `@IsOptional() @IsEnum([...])` on `GeneralSettingsDto` in `apps/backend/src/domains/store/settings/dto/settings-schemas.dto.ts`. `industry: 'retail'` added inside the `general` block of `getDefaultStoreSettings()` in `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts`. In `settings.service.ts`, the existing `if (dto.general)` block is extended: `let { name, logo_url, store_type, timezone, industry } = dto.general;` and `if (industry !== undefined) storeUpdateData.industry = industry;`.
   Verification: `npm run build -w apps/backend` exits 0. `npm run test -w apps/backend -- --runInBand src/domains/store/settings/defaults/default-store-settings.spec.ts` passes (the test asserts default-shape keys; we update it to include `industry`). Bruno: `PUT /store/settings/general` with `industry: 'restaurant'` returns 200; subsequent `GET /store/settings` returns `general.industry === 'restaurant'`; `SELECT industry FROM stores WHERE id = $storeId` returns `'restaurant'`. Reverting the value with `PUT` body `{ "industry": "retail" }` persists the revert.

4. **Frontend settings form — add "Tipo de Negocio" selector**
   Skills: `vendix-zoneless-signals`, `vendix-angular-forms`, `vendix-settings-system`
   Resources: `npm run build:prod -w apps/frontend`; `npm run zoneless:audit`; manual UI check at `/admin/settings/general`.
   Business decision: The selector lives in the same `Información Básica` card as `Tipo de Tienda`, immediately below it, to make the orthogonality obvious to the user. A sibling info block describes the consequence per value, mirroring the existing `@switch (storeTypeControl.value)` block. For now the per-value text is informative only ("Habilita módulos del módulo de Operaciones como Recetas…"); no per-value behavior is implemented in this plan. `industry` is mirrored in the frontend `GeneralSettings` interface in `apps/frontend/src/app/core/models/store-settings.interface.ts`.
   Why: This is the primary user-facing surface; the field is useless if it can only be set programmatically.
   Output: `industries: SelectorOption[] = [{ value: 'retail', label: 'Retail' }, { value: 'restaurant', label: 'Restaurante' }, { value: 'manufacturing', label: 'Manufactura / Elaboración propia' }, { value: 'service', label: 'Servicios' }]` in the component. `industry: new FormControl('retail')` in the form group. `<app-selector [formControl]="industryControl" label="Tipo de Negocio" [options]="industries" .../>` plus a sibling info `<div>` with `@switch (industryControl.value)` in the HTML. `industry?: StoreIndustry` added to the `GeneralSettings` interface in `apps/frontend/src/app/core/models/store-settings.interface.ts`.
   Verification: `npm run build:prod -w apps/frontend` exits 0. `npm run zoneless:audit` shows no new violations. Manual UI: open `/admin/settings/general`, change "Tipo de Negocio" to "Restaurante", click save, refresh the page — the value persists. The same flow with a brand-new store (no row in `store_settings` yet) defaults to "Retail" and the `general.industry` field appears in the `GET /store/settings` response.

5. **Frontend super-admin / org-admin store forms — add `industry` control**
   Skills: `vendix-zoneless-signals`, `vendix-angular-forms`, `vendix-backend-api`
   Resources: `npm run build:prod -w apps/frontend`; manual UI smoke in super-admin and org-admin store create flows.
   Business decision: Both creation paths (super-admin and org-admin) and the super-admin edit path MUST allow setting `industry` at creation / edit time. Default value in the form is `RETAIL` to preserve today's behavior; the new `StoreIndustry` enum is imported from the shared DTO module (`@shared-types` or direct import, matching the existing `StoreType` import pattern).
   Why: Without this, `industry` would default to `retail` for every new store created from super-admin / org-admin, forcing restaurant owners to do a second step in `/admin/settings/general` after creation. For a SaaS, "set industry at onboarding" matters.
   Output: `industry` form control defaulting to `StoreIndustry.RETAIL` in `apps/frontend/src/app/private/modules/super-admin/stores/components/store-create-modal.component.ts`, `apps/frontend/src/app/private/modules/super-admin/stores/components/store-edit-modal.component.ts`, and `apps/frontend/src/app/private/modules/organization/stores/components/store-create-modal/store-create-modal.component.ts`. The submitted `CreateStoreDto` payload includes `industry: formData.industry as StoreIndustry`. The edit form's `populateForm()` includes `industry: store.industry || StoreIndustry.RETAIL`.
   Verification: `npm run build:prod -w apps/frontend` exits 0. Manual UI: super-admin creates a new store, picks "Restaurante" in the form, submits; `SELECT industry FROM stores WHERE id = $newId` returns `'restaurant'`. Org-admin creates a new store with industry "Manufactura"; same check. Super-admin edits an existing store, changes industry to "Servicios", saves; `UPDATE stores SET industry = 'service' WHERE id = $id` is observable.

6. **Menu filter readiness — read `industry`, add empty `industryHiddenModules`, snapshot signal**
   Skills: `vendix-panel-ui`, `vendix-zoneless-signals`
   Resources: `npm run build:prod -w apps/frontend`; `npm run zoneless:audit`.
   Business decision: The new dimension is **read** in `MenuFilterService` and an empty `industryHiddenModules` map is added, so the upcoming Operations / KDS plans can register per-industry module rules without re-plumbing the filter. We do NOT add any rules in this plan — that is the job of those follow-up plans. JWT payload is NOT extended in this plan: settings remains the source of truth; the snapshot fallback in `authFacade.userStoreIndustry$` exists for the rare offline-read path and to keep the file symmetric with `userStoreType$`.
   Why: Locking the wiring in this plan keeps the next plan's diff minimal and reviewable. Skipping this would force the next plan to thread `industry` through the filter alongside the new module keys.
   Output: `private industryHiddenModules: Record<string, string[]> = {}` next to `storeTypeHiddenModules` in `menu-filter.service.ts`. The filter reads `const industry = storeSettings?.general?.industry || loginStoreIndustry;` and applies `industryHiddenModules[industry || '']` to the effective modules list, with a comment explaining the map is intentionally empty in this plan. `authFacade` adds `readonly userStoreIndustry$` and `readonly userStoreIndustry = toSignal(...)` mirroring the existing `userStoreType` pair. `auth.selectors.ts` adds `export const selectUserStoreIndustry = createSelector(...)` reading `store?.industry`.
   Verification: `npm run build:prod -w apps/frontend` exits 0. `npm run zoneless:audit` shows no new violations. Manual UI: log in as a `physical + retail` store, sidebar is byte-identical to today. Log in as a `physical + restaurant` store (after setting industry via Settings → General), sidebar is also byte-identical to today — the rules map is intentionally empty. The plumbing is observable: in the browser dev tools, `authFacade.userStoreIndustry()` returns the expected value.

7. **Default-templates seed — keep `store_default_settings` in sync (hygiene only)**
   Skills: `vendix-prisma-seed`, `vendix-settings-system`
   Resources: `npm run db:reset-seed` in dev only (NEVER in production). Read `default_templates` row after re-seed.
   Business decision: The auto-merge in `DefaultPanelUIService.getUnifiedTemplate()` already covers visibility for privileged users, so the seed is not load-bearing for the panel_ui side. We update the seed only for the `store_settings.general` default block so fresh stores inherit `industry: 'retail'` consistently with `getDefaultStoreSettings()`. This is hygiene — production stores are not affected by `db:reset-seed`.
   Why: Avoid drift between the hardcoded default in `getDefaultStoreSettings()` and the seeded template; future debugging is easier when both sources agree.
   Output: In `apps/backend/prisma/seeds/default-templates.seed.ts`, the seeded `store_default_settings` JSON gets `general.industry: 'retail'` if a `general` block is present. No other change in the seed.
   Verification: After `npm run db:reset-seed`, `SELECT settings->'general'->>'industry' FROM default_templates WHERE slug = 'store_default_settings'` (or equivalent lookup) returns `'retail'`. Production `default_templates` is not touched by this plan.

## End-to-End Verification

1. **Migration & DB shape**:
   - `npx prisma migrate status` shows `add_industry_enum` applied with no drift.
   - `SELECT enum_range(NULL::industry_enum)` returns `{retail,restaurant,manufacturing,service}`.
   - `SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='stores' AND column_name='industry'` returns `industry_enum` / `retail`.
   - `SELECT count(*) FROM stores WHERE industry IS NULL` returns `0` (existing rows backfilled by default).
2. **Backend contract** — Bruno collection `bruno/store/settings-industry.bru`:
   - `GET /store/settings` returns `general.industry === 'retail'` for a fresh store.
   - `PUT /store/settings/general` with `industry: 'restaurant'` returns 200; `GET /store/settings` echoes `restaurant`; `SELECT industry FROM stores WHERE id = $storeId` matches.
   - `POST /superadmin/stores` with `industry: 'restaurant'` returns 201 with the field echoed.
   - `POST /superadmin/stores` with `industry: 'bogus'` returns 400.
   - `GET /superadmin/stores?industry=restaurant` filters correctly.
3. **Builds**:
   - `npm run build -w apps/backend` exits 0.
   - `npm run build:prod -w apps/frontend` exits 0.
   - `npm run zoneless:audit` shows no new violations.
4. **UI smoke**:
   - Open `/admin/settings/general`, change "Tipo de Negocio" to "Restaurante", save, refresh — persists.
   - Open super-admin Stores → Create, set "Tipo de Negocio" to "Restaurante", submit — new store has `industry: 'restaurant'`.
   - Open org-admin Stores → Create, same flow with "Manufactura" — `industry: 'manufacturing'`.
   - Log in as a `physical + retail` user — sidebar is byte-identical to today. Log in as a `physical + restaurant` user (after switching industry in Settings) — sidebar is also byte-identical to today (the rules map is intentionally empty in this plan).

## Knowledge Gaps

None. The plumbing mirrors existing `store_type` patterns exactly (DTO enum, settings sync, settings form, menu filter map, auth snapshot signal). The follow-up plans for the restaurant Operations module (recipes) and Kitchen Display System will be where any genuinely new patterns appear; those plans should propose new skills (e.g. `vendix-store-industry` or extensions to `vendix-panel-ui` and `vendix-inventory-stock`) at that point, not this one.

## Approval Request

This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
