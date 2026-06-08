# Plan: `industries` Multi-Select Foundation (Restaurant / Manufacturing / Service Readiness)

## Context

Vendix today differentiates stores by **modality** (`store_type`: `physical | online | hybrid | popup | kiosko`) and uses that value to drive sidebar visibility. The user wants Vendix to also support restaurant workflows (recipe-driven menu, kitchen display, table ops) and other elaboration-based businesses (manufacturing, services, dark kitchens, coffee shops, hotels). A single-value `industry` field breaks real-world tenants: a hotel sells lodging (service) + food (restaurant) + souvenirs (retail); a café with coworking sells coffee (retail) and rents space (service); a minimarket also does tech repairs (service). Forcing a tenant to pick ONE industry would lock them out of features their business actually uses. The fix is a **multi-select** `industries: StoreIndustry[]` field, persisted on `stores.industries` and mirrored through `store_settings.settings.general.industries`. The menu filter combines the per-industry rules with **OR semantics** (a module is shown if it is enabled for AT LEAST ONE of the user's industries). Default is `['retail']` so existing tenants are unchanged. This plan adds the foundation only — recipes, KDS, and per-industry module rules live in follow-up plans.

## General Objective

Vendix stores carry an `industries` array (multi-select) orthogonal to `store_type`, editable from Settings and from super-admin / org-admin store forms, persisted on `stores.industries` with default `['retail']`, and exposed to `MenuFilterService` with OR semantics so per-industry module rules can be added in follow-up plans without re-plumbing the filter.

## Specific Objectives

1. `industry_enum` exists in Postgres with values `retail`, `restaurant`, `manufacturing`, `service`; `stores.industries` column exists as `industry_enum[]` with default `ARRAY['retail']::industry_enum[]`; migration is idempotent and safe on populated DBs.
2. Backend TS enum `StoreIndustry` exported from the stores DTO module; `industries?: StoreIndustry[]` on `CreateStoreDto`, `UpdateStoreDto`, and `StoreQueryDto` validated with `@IsArray() @IsEnum(StoreIndustry, { each: true })`. Invalid / mixed values return 400.
3. `store_settings.settings.general.industries` exists; `getDefaultStoreSettings()` returns `industries: ['retail']`; `settings.service.ts` syncs incoming `industries` to `stores.industries` (same pattern as `store_type`).
4. `settings-schemas.dto.ts` validates the field as an array; `GeneralSettings` interface includes `industries?: StoreIndustry[]`.
5. Frontend `general-settings-form` shows a multi-select "Tipos de Negocio" control below "Tipo de Tienda", persists as an array, reads back; the form's `general` payload type mirrors the backend interface.
6. Frontend super-admin `store-create-modal`, super-admin `store-edit-modal`, and org-admin `store-create-modal` include `industries` (array) in the form and the submit payload.
7. `MenuFilterService` reads `industries` from settings (with snapshot fallback) and applies per-industry rules with **OR semantics**: a module is hidden only if it is hidden for EVERY one of the user's industries; visible if enabled for at least one. An empty `industryHiddenModules` map is added (rules to be added in follow-up plans).
8. `authFacade.userIndustries$` signal and `selectUserIndustries` selector exist to support the snapshot fallback path; JWT payload is NOT extended in this plan.

## Approach Chosen

A new Prisma enum `industry_enum` plus a `stores.industries industry_enum[] @default([retail])` array column. The array is mirrored into `store_settings.settings.general.industries` (dual persistence, same pattern as `store_type`) so it travels through the existing save / sync / audit path. The frontend form uses a multi-select control (checkboxes or chip-style multi-selector — UX decision deferred to implementation; backend contract is just an array of strings). The `MenuFilterService` is extended to read the array and to apply the union of per-industry rules with OR semantics; the rules map is intentionally empty in this plan. The snapshot signal pair `userIndustries$` / `userIndustries` is added symmetric to `userStoreType$` for offline reads. Default is `['retail']` so existing tenants see no change.

## Alternatives Considered

- **Single-value `industry` (enum, not array)**: rejected because real tenants are multi-industry (hotel = service + restaurant + retail; café = retail + service; minimarket = retail + service; panadería con catering = retail + service). Forcing a single value would lock paying customers out of features their business legitimately needs.
- **Multiple boolean columns (`is_restaurant`, `is_manufacturing`, ...)** on `stores`: rejected because it does not scale (every new industry needs a migration + form change + DTO change), it is unqueryable for "stores that do X" without OR'ing columns, and it is harder to map to a `MenuFilterService` rules map keyed by industry.
- **JSON column with array of strings** on `stores` (no enum): rejected because it loses DB-level validation of values and makes analytics / superadmin list filters awkward. The enum array gives us type safety, queryability (`WHERE 'restaurant' = ANY(industries)`), and the same operational ergonomics as a single-value enum.
- **Reuse `store_type_enum` and add industry values** (`physical_restaurant`, ...): rejected for the same reason as in the previous plan revision — confuses modality with industry and explodes combinatorially when a tenant is `physical + hybrid` AND `restaurant + service`.

## Critical Files

- `apps/backend/prisma/schema.prisma` — add `industry_enum`; add `industries industry_enum[] @default([retail])` on `stores`.
- `apps/backend/prisma/migrations/<timestamp>_add_industries_array/migration.sql` — new migration, idempotent SQL.
- `apps/backend/src/domains/store/stores/dto/index.ts` — add `StoreIndustry` TS enum; add `industries?: StoreIndustry[]` to `CreateStoreDto`, `UpdateStoreDto`, `StoreQueryDto`.
- `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts` — add `industries?: StoreIndustry[]` to `GeneralSettings`.
- `apps/backend/src/domains/store/settings/dto/settings-schemas.dto.ts` — add `industries?: StoreIndustry[]` + `@IsArray() @IsEnum(StoreIndustry, { each: true })` to `GeneralSettingsDto`.
- `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts` — add `industries: ['retail']` in `general` defaults.
- `apps/backend/src/domains/store/settings/settings.service.ts` — extend the `dto.general` block to sync `industries` to `stores.industries` using `set` SQL or array assignment.
- `apps/frontend/src/app/core/models/store-settings.interface.ts` — add `industries?: StoreIndustry[]` to `GeneralSettings` mirror type.
- `apps/frontend/src/app/private/modules/store/settings/general/components/general-settings-form/general-settings-form.component.ts` — add `industries: SelectorOption[]`, `industryControl: FormControl<string[]>`, multi-select wiring.
- `apps/frontend/src/app/private/modules/store/settings/general/components/general-settings-form/general-settings-form.component.html` — add multi-select control + sibling info block.
- `apps/frontend/src/app/private/modules/super-admin/stores/components/store-create-modal.component.ts` — add `industries` form control + payload mapping.
- `apps/frontend/src/app/private/modules/super-admin/stores/components/store-edit-modal.component.ts` — add `industries` form control + payload mapping.
- `apps/frontend/src/app/private/modules/organization/stores/components/store-create-modal/store-create-modal.component.ts` — add `industries` form control + payload mapping.
- `apps/frontend/src/app/core/services/menu-filter.service.ts` — add `industryHiddenModules` map + OR-semantics filter logic.
- `apps/frontend/src/app/core/store/auth/auth.selectors.ts` — add `selectUserIndustries` reading `store?.industries`.
- `apps/frontend/src/app/core/store/auth/auth.facade.ts` — add `userIndustries$` Observable and `userIndustries` signal.

## Reusable Assets

- `apps/backend/src/domains/store/settings/settings.service.ts:397-453` — exact pattern for syncing `name | logo_url | store_type | timezone` from `dto.general` to `stores`. Mirrored for `industries` (Step 3). For array values, the assignment is direct (`storeUpdateData.industries = industries`) and Prisma serializes to a Postgres array.
- `apps/backend/src/domains/store/stores/dto/index.ts:19-25` — `StoreType` TS enum. Mirrored for `StoreIndustry` (Step 2).
- `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts:51-56` — `general` defaults shape. Added to (Step 3).
- `apps/frontend/src/app/private/modules/store/settings/general/components/general-settings-form/general-settings-form.component.ts:74-80` — `storeTypes: SelectorOption[]`. Mirrored for `industries` (Step 4) — the data shape is reused, the form control changes to multi-select.
- `apps/frontend/src/app/core/services/menu-filter.service.ts:30-35` and `200-207` — `storeTypeHiddenModules` map and the `effectiveModules` filter logic. Mirrored for `industries` with OR semantics (Step 6).
- `apps/frontend/src/app/core/store/auth/auth.facade.ts:95-96` and `192` — `userStoreType$` and `userStoreType` signal. Mirrored for `userIndustries$` / `userIndustries` (Step 6).
- `apps/frontend/src/app/core/store/auth/auth.selectors.ts:229-231` — `selectUserStoreType`. Mirrored for `selectUserIndustries` (Step 6).
- `apps/frontend/src/app/shared/components/multi-selector/` or `apps/frontend/src/app/shared/components/chip-multiselect/` (if either exists after a quick scan) — reused for the multi-select UI control. If neither exists, implementation creates a minimal `app-multi-checkbox-group` component in the form's local folder, deferring a shared extraction to a follow-up if more than 2 forms need it.

## Steps

1. **Add `industry_enum` and `stores.industries` array column (idempotent migration)**
   Skills: `vendix-prisma-schema`, `vendix-prisma-migrations`, `vendix-prisma`
   Resources: `npm run db:migrate:dev -w apps/backend -- --name add_industries_array`; `npm run prisma:generate -w apps/backend`; manual `psql` introspection.
   Business decision: 4-value closed enum as the near-term target taxonomy. The column is a `industry_enum[]` (Postgres array) with `DEFAULT ARRAY['retail']::industry_enum[]` so existing rows are backfilled to `['retail']` automatically. We do NOT attempt to auto-classify existing tenants; the default is the safe minimal assumption that the user can correct via Settings.
   Why: First step. Every other step assumes the column and enum exist.
   Output: `enum industry_enum { retail, restaurant, manufacturing, service }` in `schema.prisma`; `industries industry_enum[] @default([retail])` on the `stores` model. New migration `apps/backend/prisma/migrations/<timestamp>_add_industries_array/migration.sql` with idempotent SQL: `CREATE TYPE` guarded by `pg_type` check; `ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "industries" "industry_enum"[] NOT NULL DEFAULT ARRAY['retail']::"industry_enum"[];`.
   Verification: `npx prisma migrate status` shows the new migration applied. `SELECT enum_range(NULL::industry_enum)` returns `{retail,restaurant,manufacturing,service}`. `SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='stores' AND column_name='industries'` returns `ARRAY` / `ARRAY['retail']`. `SELECT industries FROM stores LIMIT 5` shows `{'retail'}` for every row.

2. **Add `StoreIndustry` TS enum and DTO fields (array, each-validated)**
   Skills: `vendix-backend-api`, `vendix-validation`, `vendix-naming-conventions`
   Resources: `npm run build -w apps/backend`; manual curl with smoke Bruno request.
   Business decision: TS enum mirrors the Prisma enum. The field is an array, optional, validated as `@IsArray() @IsEnum(StoreIndustry, { each: true })`. The DTO also accepts `industries` on `StoreQueryDto` for superadmin list filter parity — Prisma 7's `String[]` / enum array supports the `has` / `hasEvery` / `hasSome` operators for filter, we use `has` for a "store includes this industry" check.
   Why: After Step 1 the column exists but no API accepts it. DTOs are required for the next step (settings sync) and for the superadmin / org-admin store mutations.
   Output: `StoreIndustry` enum exported from `apps/backend/src/domains/store/stores/dto/index.ts` with values matching the Prisma enum. `industries?: StoreIndustry[]` on `CreateStoreDto`, `UpdateStoreDto`, and `StoreQueryDto` (the query DTO uses the same validators).
   Verification: `npm run build -w apps/backend` exits 0. Smoke: `POST /superadmin/stores` with `industries: ['retail', 'restaurant']` returns 201 with the array echoed. Same request with `industries: ['bogus']` returns 400. Mixed valid+invalid `['retail', 'bogus']` returns 400. `GET /superadmin/stores?industries=restaurant` filters to stores that include `restaurant`.

3. **Mirror `industries` through `store_settings` (interface, DTO, defaults, sync)**
   Skills: `vendix-settings-system`, `vendix-backend-api`, `vendix-validation`
   Resources: `npm run build -w apps/backend`; `npm run test -w apps/backend -- --runInBand src/domains/store/settings/defaults/default-store-settings.spec.ts`; Bruno collection `bruno/store/settings-industries.bru`.
   Business decision: `industries` lives in `store_settings.settings.general` (same place as `store_type`). The sync to `stores.industries` follows the existing pattern — `if (industries !== undefined) storeUpdateData.industries = industries;`. Prisma serializes the string array to a Postgres array automatically. We do NOT change the merge / migration machinery.
   Why: Without this, `industries` would only be settable from superadmin / org admin and not from the primary user-facing settings page.
   Output: `industries?: StoreIndustry[]` on the `GeneralSettings` interface in `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts`. `industries?: StoreIndustry[]` + `@IsArray() @IsEnum(StoreIndustry, { each: true })` on `GeneralSettingsDto` in `apps/backend/src/domains/store/settings/dto/settings-schemas.dto.ts`. `industries: ['retail']` added inside the `general` block of `getDefaultStoreSettings()` in `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts`. In `settings.service.ts`, the existing `if (dto.general)` block is extended: `let { name, logo_url, store_type, timezone, industries } = dto.general;` and `if (industries !== undefined) storeUpdateData.industries = industries;`. If the incoming array is empty, the service does NOT overwrite — empty `industries` is treated as "no change" and a warning is logged; otherwise a tenant could lock themselves out of all modules. (We document this in the OpenAPI description too.)
   Verification: `npm run build -w apps/backend` exits 0. Default-store-settings spec passes. Bruno: `PUT /store/settings/general` with `industries: ['retail', 'restaurant']` returns 200; subsequent `GET /store/settings` returns `general.industries === ['retail', 'restaurant']`; `SELECT industries FROM stores WHERE id = $storeId` returns `{'retail','restaurant'}`. `PUT` with `industries: []` is accepted but does NOT update `stores.industries` (existing value preserved). `PUT` with `industries: ['retail']` reverts correctly.

4. **Frontend settings form — add multi-select "Tipos de Negocio" control**
   Skills: `vendix-zoneless-signals`, `vendix-angular-forms`, `vendix-settings-system`
   Resources: `npm run build:prod -w apps/frontend`; `npm run zoneless:audit`; manual UI check at `/admin/settings/general`.
   Business decision: The multi-select lives in the same `Información Básica` card as `Tipo de Tienda`, immediately below it, to make the orthogonality obvious. A sibling info block describes the consequence of the multi-select (with the OR-semantics explanation: "puedes marcar varias; los módulos se muestran si están disponibles para al menos una"). For now the per-value text is informative only. The control writes / reads an array; minimum 1 value is enforced client-side (the backend's "empty array is a no-op" rule is the safety net).
   Why: This is the primary user-facing surface; the field is useless if it can only be set programmatically.
   Output: `industries: SelectorOption[]` (same shape as `storeTypes`) in the component. `industries: new FormControl<string[]>(['retail'])` in the form group (the inner control is a `FormArray`-like or a custom control that exposes `string[]`; if the existing `app-selector` does not support multi, implementation uses a simple checkbox group rendered inline, or introduces a minimal `app-multi-checkbox-group` local component). `<app-multi-checkbox-group [formControl]="industriesControl" label="Tipos de Negocio" [options]="industries" ... />` (or equivalent rendered as a row of checkboxes) in the HTML, plus a sibling info block. `industries?: StoreIndustry[]` added to the frontend `GeneralSettings` interface in `apps/frontend/src/app/core/models/store-settings.interface.ts`.
   Verification: `npm run build:prod -w apps/frontend` exits 0. `npm run zoneless:audit` shows no new violations. Manual UI: open `/admin/settings/general`, add "Restaurante" to "Tipos de Negocio", save, refresh — array `['retail', 'restaurant']` persists. Open the same store from super-admin, observe the same array. A brand-new store defaults to `['retail']`.

5. **Frontend super-admin / org-admin store forms — add `industries` (array) control**
   Skills: `vendix-zoneless-signals`, `vendix-angular-forms`, `vendix-backend-api`
   Resources: `npm run build:prod -w apps/frontend`; manual UI smoke in super-admin and org-admin store create / edit flows.
   Business decision: Both creation paths (super-admin and org-admin) and the super-admin edit path MUST allow setting `industries` at creation / edit time. Default value in the form is `['retail']` to preserve today's behavior. The submitted `CreateStoreDto` payload includes `industries: formData.industries`. The edit form's `populateForm()` includes `industries: store.industries && store.industries.length ? store.industries : ['retail']`.
   Why: Without this, `industries` would default to `['retail']` for every new store, forcing hotel / multi-industry owners to do a second step in `/admin/settings/general` after creation. For a SaaS, "set industries at onboarding" matters.
   Output: `industries` form control defaulting to `['retail']` in `apps/frontend/src/app/private/modules/super-admin/stores/components/store-create-modal.component.ts`, `apps/frontend/src/app/private/modules/super-admin/stores/components/store-edit-modal.component.ts`, and `apps/frontend/src/app/private/modules/organization/stores/components/store-create-modal/store-create-modal.component.ts`. The submitted `CreateStoreDto` payload includes `industries: formData.industries`. The edit form's `populateForm()` includes `industries` from the store record.
   Verification: `npm run build:prod -w apps/frontend` exits 0. Manual UI: super-admin creates a new store, marks "Restaurante" + "Servicios" in the form, submits; `SELECT industries FROM stores WHERE id = $newId` returns `{'restaurant','service'}`. Org-admin creates a new store with "Retail" + "Manufactura"; same check. Super-admin edits an existing store, changes industries to "Retail" only, saves; `UPDATE stores SET industries = ARRAY['retail']::industry_enum[]` is observable.

6. **Menu filter readiness — read `industries` (array), apply OR semantics, snapshot signal**
   Skills: `vendix-panel-ui`, `vendix-zoneless-signals`
   Resources: `npm run build:prod -w apps/frontend`; `npm run zoneless:audit`.
   Business decision: The new dimension is **read** in `MenuFilterService` as an array. The per-industry rules map is empty in this plan. The filter applies **OR semantics**: a module is hidden only if it is hidden for EVERY one of the user's industries. Empty industries (defensive — should not happen thanks to the default + min-1 client validation + backend "empty is a no-op" rule) falls back to the existing `['retail']` view. JWT payload is NOT extended in this plan: settings remains the source of truth; the snapshot fallback in `authFacade.userIndustries$` exists for the rare offline-read path and to keep the file symmetric with `userStoreType$`.
   Why: Locking the wiring in this plan keeps the next plan's diff minimal and reviewable. Skipping this would force the next plan to thread `industries` through the filter alongside the new module keys.
   Output: `private industryHiddenModules: Record<string, string[]> = {}` next to `storeTypeHiddenModules` in `menu-filter.service.ts`. The filter reads `const industries = storeSettings?.general?.industries || loginIndustries || ['retail'];` and computes `const hiddenByIndustries = industries.flatMap(ind => industryHiddenModules[ind] || []);` followed by `const uniqueHiddenByIndustries = Array.from(new Set(hiddenByIndustries));` then applies the same `effectiveModules.filter(m => !uniqueHiddenByIndustries.includes(m))` pattern. A comment explains the OR semantics and that the map is intentionally empty. `authFacade` adds `readonly userIndustries$` and `readonly userIndustries = toSignal(...)`. `auth.selectors.ts` adds `export const selectUserIndustries = createSelector(...)` reading `store?.industries`.
   Verification: `npm run build:prod -w apps/frontend` exits 0. `npm run zoneless:audit` shows no new violations. Manual UI: log in as a `physical + ['retail']` store, sidebar is byte-identical to today. Log in as a `physical + ['retail', 'restaurant']` store (after setting industries via Settings), sidebar is also byte-identical to today (the rules map is intentionally empty). The plumbing is observable: in the browser dev tools, `authFacade.userIndustries()` returns the expected array.

7. **Default-templates seed — keep `store_default_settings` in sync (hygiene only)**
   Skills: `vendix-prisma-seed`, `vendix-settings-system`
   Resources: `npm run db:reset-seed` in dev only (NEVER in production).
   Business decision: The auto-merge in `DefaultPanelUIService.getUnifiedTemplate()` already covers visibility for privileged users, so the seed is not load-bearing for the panel_ui side. We update the seed only for the `store_settings.general` default block so fresh stores inherit `industries: ['retail']` consistently with `getDefaultStoreSettings()`.
   Why: Avoid drift between the hardcoded default and the seeded template; future debugging is easier when both sources agree.
   Output: In `apps/backend/prisma/seeds/default-templates.seed.ts`, the seeded `store_default_settings` JSON gets `general.industries: ['retail']` if a `general` block is present. No other change in the seed.
   Verification: After `npm run db:reset-seed`, `SELECT settings->'general'->>'industries' FROM default_templates WHERE slug = 'store_default_settings'` returns `["retail"]` (or equivalent JSONB path). Production `default_templates` is not touched by this plan.

## End-to-End Verification

1. **Migration & DB shape**:
   - `npx prisma migrate status` shows `add_industries_array` applied with no drift.
   - `SELECT enum_range(NULL::industry_enum)` returns `{retail,restaurant,manufacturing,service}`.
   - `SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='stores' AND column_name='industries'` returns `ARRAY` / the array default.
   - `SELECT industries FROM stores LIMIT 5` shows `{'retail'}` for every existing row.
2. **Backend contract** — Bruno collection `bruno/store/settings-industries.bru`:
   - `GET /store/settings` returns `general.industries === ['retail']` for a fresh store.
   - `PUT /store/settings/general` with `industries: ['retail', 'restaurant']` returns 200; `GET /store/settings` echoes `['retail', 'restaurant']`; `SELECT industries FROM stores WHERE id = $storeId` matches.
   - `PUT` with `industries: []` returns 200 and does NOT change `stores.industries`.
   - `PUT` with `industries: ['bogus']` returns 400; mixed `['retail', 'bogus']` returns 400.
   - `POST /superadmin/stores` with `industries: ['restaurant', 'service']` returns 201 with the array echoed.
   - `GET /superadmin/stores?industries=restaurant` filters to stores that include `restaurant`.
3. **Builds**:
   - `npm run build -w apps/backend` exits 0.
   - `npm run build:prod -w apps/frontend` exits 0.
   - `npm run zoneless:audit` shows no new violations.
4. **UI smoke**:
   - Open `/admin/settings/general`, mark "Restaurante" in "Tipos de Negocio", save, refresh — array persists.
   - Open super-admin Stores → Create, mark "Restaurante" + "Servicios", submit — new store has `industries: ['restaurant', 'service']`.
   - Open org-admin Stores → Create, same flow with "Retail" + "Manufactura" — `['retail', 'manufacturing']`.
   - Log in as a `physical + ['retail']` user — sidebar is byte-identical to today. Log in as a `physical + ['retail', 'restaurant']` user (after switching industries in Settings) — sidebar is also byte-identical to today (the rules map is intentionally empty in this plan).

## Knowledge Gaps

None for this plan. The plumbing mirrors existing `store_type` patterns exactly (DTO enum, settings sync, settings form, menu filter map, auth snapshot signal). The follow-up plans for the restaurant Operations module (recipes) and Kitchen Display System will be where any genuinely new patterns appear; those plans should propose new skills (e.g. `vendix-store-industries` or extensions to `vendix-panel-ui` and `vendix-inventory-stock`) at that point, not this one. One minor known gap: the multi-select UI control is a likely candidate for extraction into a shared component if more than 2 forms need it — implementation should keep it local to the form and only extract when the second consumer appears.

## Approval Request

This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
