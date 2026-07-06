---
name: mobile-parity-audit
description: >
  Audit web↔mobile feature parity for Vendix: produce a granular functional inventory of a named web
  feature/module/flow (apps/frontend + its backend contracts), compare it capability-by-capability
  against the React Native mobile app (apps/mobile), emit a strategic gap map (Present / Partial /
  Absent / N/A), and hand the structured result to how-to-plan → how-to-dev → how-to-test to drive the
  mobile implementation.
  Trigger: When a developer asks to analyze/compare a web feature vs mobile, audit mobile parity, map
  what mobile is missing relative to web, produce a mobile implementation backlog from a web module, or
  plan mobile work that must mirror an existing web flow.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Analyzing or comparing a web feature/module/flow against the mobile app"
    - "Auditing web↔mobile feature parity or mobile coverage gaps"
    - "Building a granular functional inventory of a web module for mobile replication"
    - "Producing a strategic gap map of what mobile has vs what it lacks relative to web"
    - "Deriving a mobile implementation plan/backlog from an existing web module"
allowed-tools: Read, Glob, Grep, Bash
---

# Mobile Parity Audit

## Purpose

Vendix has an **independent React Native (Expo) mobile team** building `apps/mobile` as a **parallel
client to the web app** — same backend, same business rules, **mobile UI reaching functional parity**
with the web client. This skill governs the *analysis* that makes that parity measurable:

1. Take a web target the developer names (a feature, module, flow, or screen).
2. Produce an **exhaustive, granular functional inventory** of everything that web target does.
3. Compare it, capability by capability, against what already exists in `apps/mobile`.
4. Emit a **strategic gap map**: what is Present, Partial, Absent, or N/A on mobile, prioritized.
5. Hand that structured result to `how-to-plan` → `how-to-dev` → `how-to-test` to build and verify the
   mobile implementation.

**This skill does NOT govern:** how to write mobile code (that is `mobile-dev`), how to structure the
plan (that is `how-to-plan`), or how to run tests (that is `how-to-test`). It produces the **input**
those skills consume. During the audit itself, work is **read-only in both trees**.

## Core Rules

- **Read-only audit.** The audit phase reads `apps/frontend`, `apps/backend`, `libs/`, and
  `apps/mobile` — it writes **no source code**. The only artifact produced is the parity report
  (written under the scratchpad or a path the user names, never inside a skill folder).
- **Compare capabilities, not files.** Web (`apps/frontend`) resolves surface by `app_type`
  (hostname) and module visibility via `panel_ui` / industry / permissions; mobile
  (`apps/mobile`) resolves surface by **expo-router route groups** (`(auth)`, `(org-admin)`,
  `(store-admin)`, `(super-admin)`) + `src/features`. Folder shapes differ — anchor every comparison
  on a **functional capability**, so "does mobile do X" is answerable regardless of file layout.
- **Establish the surface first.** Before inventorying, pin down which `app_type` / persona the web
  target lives in (STORE_ADMIN, ORG_ADMIN, SUPER_ADMIN, STORE_ECOMMERCE) and which mobile route group
  is its counterpart. A parity audit without a fixed surface produces noise.
- **Granularity is the product.** A parity report that lists "Orders module: missing" is a failure.
  Enumerate to the level of individual **actions, form fields, validations, states, permissions, and
  consumed endpoints** (see the Capability Taxonomy). The report must be minute enough that a mobile
  dev can implement from it without re-reading the web source.
- **Backend is shared, not duplicated.** Both clients call the same backend. Inventory the **endpoints
  and DTO shapes** the web target consumes so the mobile side can reuse the exact contract — never
  propose re-implementing backend logic on mobile (`mobile-dev` RULE 6).
- **Every capability gets a status.** Each row in the gap map is exactly one of: `Present`,
  `Partial`, `Absent`, or `N/A-mobile` (a web capability that legitimately does not belong on mobile —
  justify why). No blanks.
- **The audit ends by handing off, not by coding.** Its terminal output is a gap map ready to feed
  `how-to-plan`. Writing mobile code from within this skill skips the plan gate.

## Workflow

Five phases. Phases 1–4 are the audit (read-only); phase 5 is the handoff.

| Phase | Goal | Tools | Output |
| --- | --- | --- | --- |
| **1. Scope** | Fix the web target + its `app_type`/persona + the mobile counterpart route group | `Read`, `grep`, `AskUserQuestion` if ambiguous | One-line scope statement + surface mapping |
| **2. Web inventory** | Enumerate every capability of the web target using the Capability Taxonomy | `Explore`/`Read`, `grep` over `apps/frontend` + backend contracts | Granular capability list (the "web truth") |
| **3. Mobile inventory** | Enumerate what `apps/mobile` already implements for the same surface | `Explore`/`Read`, `grep` over `apps/mobile` | Mobile capability list |
| **4. Gap map** | Diff web vs mobile per capability, assign status + priority | synthesis | Strategic gap map (the deliverable) |
| **5. Handoff** | Feed the gap map to planning/dev/test | `how-to-plan`, then `how-to-dev` + `how-to-test` | Approved mobile implementation plan |

- **Phase 1** is mandatory and cannot be skipped. If the user's target is vague ("audit orders"),
  resolve *which* orders surface (store POS orders? org-admin orders list? ecommerce checkout?) before
  reading anything.
- **Phases 2 and 3 are independent** — run them as parallel `Explore` agents via `agent-teams` (one
  owns web, one owns mobile) and merge in phase 4. Cap at the `how-to-plan` limit of 3 parallel.
- **Phase 4** is pure synthesis: never re-open source to "double check" mid-diff; if the inventory is
  incomplete, return to phase 2/3, don't patch the map.
- **Phase 5** is where `how-to-plan` takes over. The gap map becomes the plan's `Context` +
  `Specific Objectives`; each Absent/Partial capability becomes one or more plan Steps.

## Capability Taxonomy (what "granular" means)

For the web target, enumerate **every** applicable dimension below. This taxonomy is the checklist
that makes the inventory exhaustive — omitting a dimension is how a parity audit silently misses work.

| # | Dimension | What to capture |
| --- | --- | --- |
| 1 | **Navigation / routes** | Every route, tab, nested view, and deep-link into the target; entry points from other modules |
| 2 | **Screens / views** | Each distinct screen or panel; list view vs detail vs create/edit vs modal |
| 3 | **Actions / CTAs** | Every button, menu item, row action, bulk action, gesture — what each triggers |
| 4 | **Forms & fields** | Every field, its type, required/optional, default, and **validation rule** (client + server) |
| 5 | **States** | empty, loading, success, error, partial, offline, skeleton, pagination-end — per view |
| 6 | **Data display** | Tables/lists/cards, columns shown, sorting, filtering, search, pagination, grouping |
| 7 | **Permissions & gating** | Required permissions, `panel_ui` visibility, industry gating, subscription/feature gates |
| 8 | **Consumed endpoints** | Every backend endpoint the target calls, method, request DTO, response shape |
| 9 | **Side-effects** | Notifications, journal entries, stock changes, prints, downloads, uploads, events fired |
| 10 | **Formatting concerns** | Currency, dates/timezone, i18n strings, number/tax formatting the view relies on |
| 11 | **Cross-module dependencies** | Shared components/services the target reuses (modals, selectors, pipes, guards) |
| 12 | **Edge cases & business rules** | Illegal-state guards, race conditions, tenant scope, role-specific variants |

For each enumerated capability, record enough to implement: **name · trigger · behavior · endpoint (if
any) · permission/gate (if any)**. This is the level the mobile dev must be able to build from.

## Deliverable — Parity Report format

The report is the single artifact this skill produces. Write it to the scratchpad (or a user-named
path), not into any skill folder. Use this exact structure:

```markdown
# Parity Audit — <web target> (<app_type / persona>)

## Scope
- Web target: <feature/module/flow> — `apps/frontend/src/app/private/modules/<...>`
- Surface / app_type: <STORE_ADMIN | ORG_ADMIN | SUPER_ADMIN | STORE_ECOMMERCE>
- Mobile counterpart: `apps/mobile/app/(<group>)/<...>` + `apps/mobile/src/features/<...>`
- Shared backend domain(s): `apps/backend/src/domains/<...>`

## Web Functional Inventory  <!-- granular, taxonomy-driven -->
### 1. Navigation / routes
- ...
### 2. Screens / views
- ...
### 3. Actions / CTAs
- ...
<!-- ...every applicable taxonomy dimension... -->

## Mobile Current State
- What exists today in apps/mobile for this surface, at the same granularity.

## Strategic Gap Map
| Capability | Web | Mobile | Status | Priority | Endpoint / gate | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| <capability> | ✅ | ❌ | Absent | P0 | `GET /store/orders` · perm `orders.read` | ... |
| <capability> | ✅ | ⚠️ | Partial | P1 | ... | mobile lacks the edit action |
| <capability> | ✅ | ✅ | Present | — | ... | parity reached |
| <capability> | ✅ | — | N/A-mobile | — | — | web-only bulk export; justify |

## Coverage Summary
- Present: N/total · Partial: N · Absent: N · N/A: N  →  <parity %>

## Recommended Sequencing (input to how-to-plan)
1. <Absent P0 capability> — why it goes first
2. <Partial P1 capability> — depends on #1
...
```

- **Status legend:** `Present` = mobile matches web behavior · `Partial` = exists but incomplete
  (missing an action, state, validation, or endpoint) · `Absent` = not on mobile · `N/A-mobile` =
  intentionally web-only (must be justified).
- **Priority (P0–P2)** reflects business value + dependency order, not effort. Effort belongs in the
  plan, not the audit.

## Handoff to Plan / Dev / Test

The gap map is the bridge, not the destination. After the report:

1. **`how-to-plan`** — feed the gap map in. The report's `Scope` → the plan's `Context`; each
   Absent/Partial capability → one or more plan `Steps`; `Recommended Sequencing` → step order. Every
   plan step must list `mobile-dev` in `Skills` (mobile edits are exclusive to `apps/mobile/`), plus
   the domain skills the capability touches (e.g. `vendix-currency-formatting`, `vendix-permissions`).
2. **`how-to-dev`** — execute the approved plan. `mobile-dev` is loaded first; all writes stay inside
   `apps/mobile/`; backend/frontend are read-only reference for contract alignment.
3. **`how-to-test`** — verify each shipped capability. Mobile UI is verified on-device / in the Expo
   client, but the **backend contract** each capability consumes is verified with `curl` (Happy / Sad
   / Brute-Force) exactly as the web client would be — the endpoint is shared, so its parity is
   provable at the API layer.

## Decision Rules

| Situation | Do |
| --- | --- |
| User names a broad module ("audit inventory") | Phase 1: split into concrete surfaces/flows, confirm which one(s) to audit |
| Web target spans multiple `app_type`s | Audit one surface per report; do not blend STORE_ADMIN and ecommerce in one map |
| A web capability clearly makes no sense on mobile | Mark `N/A-mobile` **with a justification**, never silently drop it |
| Mobile has a capability web lacks | Note it as an inverse gap in `Notes`; the audit is web→mobile but record divergence |
| Inventory feels "done" after the happy path only | Not done — the taxonomy's states/permissions/edge-cases rows are mandatory |
| Ready to write mobile code | Stop. Hand off to `how-to-plan` first — this skill never writes source |
| Web and mobile call the same endpoint differently | Flag as `Partial`; contract drift is a parity defect |

## Anti-Patterns

| Anti-pattern | Correct alternative |
| --- | --- |
| Coarse gap map ("Orders: missing") | Enumerate to actions/fields/states/endpoints per the Capability Taxonomy |
| Comparing folder trees instead of capabilities | Diff functional capabilities; folder shapes differ by design |
| Auditing without fixing the `app_type`/surface first | Phase 1 pins the surface before any reading |
| Writing mobile code from within the audit | Audit is read-only; code comes after `how-to-plan` approval under `how-to-dev` |
| Proposing to re-implement backend logic on mobile | Reuse the shared endpoint/DTO; `mobile-dev` RULE 6 forbids duplicating backend logic |
| Leaving a capability with no status | Every row is Present / Partial / Absent / N/A-mobile |
| Dropping web-only capabilities silently | Mark `N/A-mobile` with a written justification |
| Reporting parity % off the happy path only | % is computed over the full taxonomy-driven inventory |
| Re-planning inside the report | The report ends at the gap map + sequencing; `how-to-plan` owns the plan |

## Related Skills

- `mobile-dev` — **Required for the handoff.** Governs all mobile code (edits exclusive to
  `apps/mobile/`, other trees read-only). Loaded during phase 5 dev, not the audit.
- `how-to-plan` — Consumes the gap map to produce the mobile implementation plan.
- `how-to-dev` — Executes the approved plan under mobile-dev.
- `how-to-test` — Verifies each capability (curl for the shared backend contract; Expo client for UI).
- `agent-teams` — Run the web inventory (phase 2) and mobile inventory (phase 3) as parallel agents.
- `vendix-app-architecture` — `app_type` / persona resolution; how web surfaces map to mobile groups.
- `vendix-panel-ui` — Web module visibility (industry / `panel_ui` / permissions) to inventory in dim 7.
- `vendix-permissions` — Permission requirements per capability (dim 7 of the taxonomy).
- `vendix-core` — Skill map by domain, to route each capability to its owning domain skill.

## Changelog

- **v1.0** — Initial release. Five-phase read-only audit (Scope → Web inventory → Mobile inventory →
  Gap map → Handoff), 12-dimension Capability Taxonomy, Parity Report format with a
  Present/Partial/Absent/N/A gap map, and explicit handoff to how-to-plan → how-to-dev → how-to-test.
