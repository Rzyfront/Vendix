---
name: mobile-parity-audit
description: >
  Audit web↔mobile parity: granular inventory of a web feature vs apps/mobile, Present/Partial/Absent gap map and user stories for the plan.
  Trigger: compare web vs mobile, mobile parity, what mobile is missing.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
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

`apps/mobile` (Expo / React Native) is a parallel client of the same backend that must reach
functional parity with `apps/frontend`. This skill measures the gap; it writes no source code.
Mobile code is `mobile-dev`; planning is `how-to-plan` (`odd/tasks/<feature>.md`); verification is `how-to-test`.

## Rules

- **Read-only** over `apps/frontend`, `apps/backend`, `libs/`, `apps/mobile`. Only artifact: the report.
- **Fix the surface first.** Web resolves surface by `app_type` (hostname) + `panel_ui` / industry /
  permissions; mobile by expo-router groups `app/(auth)`, `(org-admin)`, `(store-admin)`,
  `(super-admin)` + `src/features/*`. One surface per report (never mix STORE_ADMIN and ecommerce).
  Vague target ("audit orders") → ask which surface/flow.
- **Compare capabilities, not files.** Folder shapes differ by design.
- **Granular:** actions, fields, validations, states, permissions, consumed endpoints. "Orders: missing"
  is a failed audit.
- **Backend is shared:** inventory endpoints and DTO shapes for reuse; never propose re-implementing
  backend logic on mobile (`mobile-dev` RULE 6).
- **Every capability gets a status:** `Present`, `Partial`, `Absent`, `N/A-mobile` (justified). No blanks.
- **Each Absent/Partial gap becomes a user story:** "Como <rol> en la app móvil <surface>, quiero
  <funcionalidad> para <resultado>", the on-screen steps (as they work on web) and observable acceptance
  criteria on mobile. Technical notes underneath.
- Ends at the gap map + stories + sequencing; never writes mobile code.

## Workflow

1. **Scope** (mandatory): web target, `app_type`/persona, mobile route group, backend domain.
2. **Web inventory** and 3. **Mobile inventory** — independent; may run as two parallel `Explore`
   agents (a named reason per `AGENTS.md`), merged in step 4.
4. **Gap map** — pure synthesis; if an inventory is incomplete, go back, don't patch the map.
5. **Handoff** — the report feeds `how-to-plan`: Scope → Specs, gap stories → Tasks in sequencing order,
   each listing `mobile-dev` + domain skills (e.g. `vendix-currency-formatting`, `vendix-permissions`).
   After implementation, `how-to-test` verifies the shared endpoint with `curl` and the UI in the Expo client.

## Capability taxonomy (enumerate every applicable dimension)

| # | Dimension | Capture |
| --- | --- | --- |
| 1 | Navigation / routes | routes, tabs, nested views, deep links, entry points |
| 2 | Screens / views | list, detail, create/edit, modal |
| 3 | Actions / CTAs | buttons, row/bulk actions, gestures and what they trigger |
| 4 | Forms & fields | type, required, default, client + server validation |
| 5 | States | empty, loading, success, error, partial, offline, pagination end |
| 6 | Data display | columns, sort, filter, search, pagination, grouping |
| 7 | Permissions & gating | permissions, `panel_ui`, industry, subscription gates |
| 8 | Consumed endpoints | method, path, request DTO, response shape |
| 9 | Side-effects | notifications, journal entries, stock, prints, uploads, events |
| 10 | Formatting | currency, dates/timezone, taxes, i18n |
| 11 | Cross-module deps | shared modals, selectors, pipes, guards |
| 12 | Edge cases & business rules | illegal-state guards, races, tenant scope, role variants |

Per capability: name · trigger · behavior · endpoint · permission/gate.
Report template: `references/report-format.md` (read on demand).

## Related Skills

`mobile-dev` · `how-to-plan` · `how-to-test` · `vendix-core` (`app_type` resolution, domain skill map) ·
`vendix-panel-ui` (module visibility) · `vendix-permissions`.
