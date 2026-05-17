## Context
`app-sticky-header` is already the shared pattern for form/detail page headers, but modules with tabs still duplicate separate tab bars or full hardcoded headers. The current codebase has three useful references: compact tabs under Superadmin monitoring, `app-scrollable-tabs` for signal-driven view switching, and the analytics tab bar for router-driven navigation. The work should add tabs as an optional sticky-header capability, then migrate the strongest existing examples before touching the broader analytics pages that currently have local edits in the worktree.

## General Objective
Make `app-sticky-header` the reusable source of truth for page headers with optional tabs, supporting both local view switching and router navigation.

## Specific Objectives
1. Add a backward-compatible optional tabs API to `app-sticky-header` without changing existing header-only usages.
2. Support state tabs and route tabs through one `StickyHeaderTab` contract.
3. Preserve compact, mobile-first horizontal scrolling, icons, focus states, and active-tab styling.
4. Migrate the closest existing examples to prove the API: Superadmin monitoring, Superadmin plan form, and analytics shell category tabs.
5. Document the new contract in the component README and the `vendix-frontend-sticky-header` skill.
6. Prepare the next migration pass for hardcoded analytics page filter headers without overwriting unrelated dirty changes.

## Approach Chosen
Extend `StickyHeaderComponent` directly with an optional second row for tabs. The component will expose `tabs`, `activeTab`, `tabsAriaLabel`, and `tabChanged`; each tab may either emit a local state change or render as a `routerLink` when a route is supplied. This keeps one public header API while preserving existing module patterns and avoiding a separate wrapper component that would recreate sticky stacking and spacing problems.

## Alternatives Considered
- Keep `app-scrollable-tabs` as a sibling below every header: rejected because each page still repeats sticky offsets, spacing, and header/tab composition.
- Project tabs with `ng-content`: rejected because the current component intentionally has a narrow API and projection would reintroduce per-page hardcoded tab markup.
- Replace all analytics hardcoded page headers in the same first pass: rejected for the initial implementation because many analytics files already have pre-existing local modifications, so the first pass should establish the shared API and migrate safer shell-level examples first.
- Build a new `app-sticky-header-tabs` component: rejected because it fragments the sticky-header pattern instead of making the current shared component more capable.

## Critical Files
- `apps/frontend/src/app/shared/components/sticky-header/sticky-header.component.ts` — defines `StickyHeaderTab`, inputs, outputs, and router support.
- `apps/frontend/src/app/shared/components/sticky-header/sticky-header.component.html` — renders optional tab row beneath the main header row.
- `apps/frontend/src/app/shared/components/sticky-header/sticky-header.component.scss` — encapsulates compact scrollable tab styling.
- `apps/frontend/src/app/shared/components/sticky-header/README.md` — documents the new tabs API and usage examples.
- `apps/frontend/src/app/shared/components/index.ts` — exports `StickyHeaderTab`.
- `skills/vendix-frontend-sticky-header/SKILL.md` — updates the project skill so future agents use the new header-tabs pattern.
- `apps/frontend/src/app/private/modules/super-admin/monitoring/monitoring-layout.component.ts` — migrates manual tabs under sticky header to configured sticky-header route tabs.
- `apps/frontend/src/app/private/modules/super-admin/subscriptions/pages/plans/plan-form.component.ts` — migrates sibling `app-scrollable-tabs` to sticky-header state tabs.
- `apps/frontend/src/app/private/modules/store/analytics/components/analytics-shell/analytics-shell.component.ts` — maps analytics registry views into sticky-header route tabs.
- `apps/frontend/src/app/private/modules/store/analytics/components/analytics-shell/analytics-shell.component.html` — replaces custom shell header and analytics tab bar with `app-sticky-header`.
- `apps/frontend/src/app/private/modules/store/analytics/components/analytics-shell/analytics-shell.component.scss` — removes shell header/tab layout rules made obsolete by sticky header.
- `apps/frontend/src/app/private/modules/store/analytics/components/analytics-tab-bar/analytics-tab-bar.component.ts` — candidate for deletion after analytics shell migration.
- `apps/frontend/src/app/private/modules/store/analytics/components/analytics-tab-bar/analytics-tab-bar.component.html` — candidate for deletion after analytics shell migration.
- `apps/frontend/src/app/private/modules/store/analytics/components/analytics-tab-bar/analytics-tab-bar.component.scss` — candidate for deletion after analytics shell migration.
- `apps/frontend/src/app/private/modules/store/analytics/components/index.ts` — removes stale analytics tab-bar export if the component is deleted.

## Reusable Assets
- `apps/frontend/src/app/shared/components/sticky-header/sticky-header.component.ts` — existing header API, action buttons, badge, metadata, and sticky placement.
- `apps/frontend/src/app/shared/components/scrollable-tabs/scrollable-tabs.component.ts` — clean state-tab input/output shape and mobile scroll behavior.
- `apps/frontend/src/app/shared/components/scrollable-tabs/scrollable-tabs.component.scss` — compact rounded tab visual reference.
- `apps/frontend/src/app/private/modules/store/analytics/components/analytics-tab-bar/analytics-tab-bar.component.ts` — router-active behavior and active-route checks.
- `apps/frontend/src/app/private/modules/super-admin/monitoring/monitoring-layout.component.ts` — compact route-tab layout directly below `app-sticky-header`.
- `apps/frontend/src/app/private/modules/super-admin/subscriptions/pages/plans/plan-form.component.ts` — state-driven form tabs with icons.
- `apps/frontend/src/app/private/modules/store/analytics/config/analytics-registry.ts` — source of analytics tab labels, icons, and routes.
- `apps/frontend/src/app/shared/components/icon/icons.registry.ts` — authoritative icon registry for existing tab icon keys.

## Steps
1. Add optional tabs API to `app-sticky-header`
   Skills: `vendix-frontend-sticky-header`, `vendix-frontend-component`, `vendix-zoneless-signals`, `vendix-ui-ux`, `vendix-frontend-icons`
   Resources: `rg -n "<app-sticky-header|app-scrollable-tabs|app-analytics-tab-bar" apps/frontend/src/app`
   Business decision: page-level tabs belong to the shared sticky header when they control a module view or sibling route group.
   Why: this must happen first because all migrations depend on a stable shared contract.
   Output: `StickyHeaderTab` type, optional tab inputs, `tabChanged` output, route-tab rendering, state-tab rendering, compact tab styling.
   Verification: `rg -n "StickyHeaderTab|tabChanged|tabsAriaLabel" apps/frontend/src/app/shared/components/sticky-header apps/frontend/src/app/shared/components/index.ts` confirms the public API exists.

2. Migrate Superadmin examples closest to the desired pattern
   Skills: `vendix-frontend-sticky-header`, `vendix-frontend-component`, `vendix-zoneless-signals`, `vendix-frontend-icons`
   Resources: `sed -n '1,130p' apps/frontend/src/app/private/modules/super-admin/monitoring/monitoring-layout.component.ts` and `sed -n '78,110p' apps/frontend/src/app/private/modules/super-admin/subscriptions/pages/plans/plan-form.component.ts`
   Business decision: Superadmin tabs should use the same header surface whether they switch child routes or in-page form sections.
   Why: these two files validate both tab modes with limited blast radius before touching analytics.
   Output: monitoring route tabs and plan-form state tabs configured on `app-sticky-header`.
   Verification: `rg -n "app-scrollable-tabs|<!-- Tabs -->|DashboardTabsComponent" apps/frontend/src/app/private/modules/super-admin/monitoring/monitoring-layout.component.ts apps/frontend/src/app/private/modules/super-admin/subscriptions/pages/plans/plan-form.component.ts` returns no obsolete tab implementation in those files.

3. Migrate analytics shell category tabs to `app-sticky-header`
   Skills: `vendix-frontend-sticky-header`, `vendix-frontend-routing`, `vendix-zoneless-signals`, `vendix-ui-ux`, `vendix-frontend-icons`
   Resources: `sed -n '1,220p' apps/frontend/src/app/private/modules/store/analytics/config/analytics-registry.ts` and `sed -n '1,180p' apps/frontend/src/app/private/modules/store/analytics/analytics.routes.ts`
   Business decision: analytics category navigation uses route tabs sourced from `analytics-registry`, not per-page duplicated markup.
   Why: analytics shell is the highest-value reusable route-tab case and proves the tab API can replace a custom tab-bar component.
   Output: analytics shell renders category title/subtitle/icon plus registry-driven route tabs through `app-sticky-header`; obsolete analytics tab-bar files are removed if unused.
   Verification: `rg -n "app-analytics-tab-bar|AnalyticsTabBarComponent" apps/frontend/src/app/private/modules/store/analytics` returns no remaining references after deletion or shows only intentionally retained references.

4. Document the sticky-header tabs pattern
   Skills: `vendix-frontend-sticky-header`, `skill-sync`
   Resources: `./skills/skill-sync/assets/sync.sh` and `./skills/setup.sh --sync`
   Business decision: this is not a new skill; it is an extension of the existing sticky-header standard.
   Why: future header/tab work must not rediscover or duplicate this pattern.
   Output: updated component README, updated source skill, synchronized generated skill copies and root instructions if metadata sync changes anything.
   Verification: `rg -n "StickyHeaderTab|tabs|tabChanged" skills/vendix-frontend-sticky-header/SKILL.md apps/frontend/src/app/shared/components/sticky-header/README.md .agents/skills/vendix-frontend-sticky-header/SKILL.md` confirms documentation is synced.

5. Inventory hardcoded analytics page headers for the next migration pass
   Skills: `vendix-frontend-sticky-header`, `vendix-frontend-component`, `vendix-zoneless-signals`, `vendix-ui-ux`
   Resources: `rg -n "Filter Bar|sticky top-0 z-10 bg-white|<h1 class=.*truncate" apps/frontend/src/app/private/modules/store/analytics -g '*.ts' -g '*.html'`
   Business decision: analytics pages with filter/action bars should eventually delegate title, subtitle, icon, actions, and tabs to shared components, but files with unrelated dirty changes must be handled deliberately.
   Why: the current worktree has many modified analytics files, so the first implementation should end with a concrete migration list instead of overwriting active work.
   Output: a concise inventory of analytics pages whose hardcoded headers can be replaced in a follow-up pass.
   Verification: `git status --short -- apps/frontend/src/app/private/modules/store/analytics` is reviewed before any later page-level header edits.

6. Verify frontend development health
   Skills: `buildcheck-dev`, `vendix-zoneless-signals`
   Resources: `docker logs --tail 40 vendix_frontend`, `docker ps`, `apps/frontend/scripts/zoneless-audit.sh`
   Business decision: shared component changes must not introduce Angular template, type, or zoneless regressions.
   Why: a shared header component affects many screens even when only a few usages are migrated.
   Output: verified frontend watch logs and zoneless audit status.
   Verification: `docker logs --tail 40 vendix_frontend` shows no relevant compile/template errors, `docker ps` shows the frontend container running, and `apps/frontend/scripts/zoneless-audit.sh` reports no new blocking issues.

## End-to-End Verification
1. Visit `/super-admin/monitoring` and confirm the sticky header renders title/actions plus route tabs, and tab navigation changes the child route.
2. Visit the Superadmin plan create/edit form and confirm the header tabs switch between Resumen, Matriz IA, Precios, and Gracia without layout jump.
3. Visit `/admin/analytics/sales`, `/admin/analytics/inventory`, and `/admin/analytics/financial` and confirm the category header plus route tabs render through `app-sticky-header`.
4. Run `docker logs --tail 40 vendix_frontend` and `docker ps`.
5. Run `apps/frontend/scripts/zoneless-audit.sh`.

## Knowledge Gaps
None. The pattern is covered by the existing `vendix-frontend-sticky-header` skill, but that skill must be updated to document the new optional tabs API.

## Approval Request
This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
