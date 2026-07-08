---
name: mobile-parity-audit
description: >
  Audit web↔mobile parity — functional AND visual — for Vendix. Produces a granular
  inventory of a named web feature/module/flow (apps/frontend + its backend contracts),
  compares it capability-by-capability AND pixel-by-pixel against the React Native
  mobile app (apps/mobile), emits a strategic gap map (Present / Partial / Absent /
  N/A applied to two independent axes: functional and visual), and hands the structured
  result to how-to-plan → how-to-dev → how-to-test to drive the mobile implementation.
  Use whenever the user asks to analyze/compare/audit/align/mirror a web feature vs the
  mobile app — including explicit visual asks like "look exactly like the web",
  "paridad visual", or "same look-and-feel as the web".
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  engram_refs:
    - "#384 — Mobile Web Visual Parity Pattern (centered card modal)"
  auto_invoke:
    - "Analyzing or comparing a web feature/module/flow against the mobile app"
    - "Auditing web↔mobile feature parity or mobile coverage gaps"
    - "Building a granular functional inventory of a web module for mobile replication"
    - "Producing a strategic gap map of what mobile has vs what it lacks relative to web"
    - "Deriving a mobile implementation plan/backlog from an existing web module"
    - "Mirroring the web's visual style on mobile"
    - "Comparing visual parity (look-and-feel) between web and mobile"
    - "Bringing a mobile modal/screen to 'look exactly like' the web"
allowed-tools: Read, Glob, Grep, Bash
---

# Mobile Parity Audit

## Purpose

Vendix has **two parallel clients** to the same backend:

- **Web** (`apps/frontend`, Angular) — the surface of record for the product
- **Mobile** (`apps/mobile`, React Native + Expo) — the parallel client

Mobile reaches parity along **two axes**, and both are non-negotiable:

1. **Functional parity** — capability-by-capability: does mobile *do* everything web does?
2. **Visual parity** — pixel-by-pixel: when mobile *does* match a web capability, does it *look*
   the same? (centered card modal, uppercase labels, content-sized buttons, exact toast strings,
   etc.)

This skill audits **both axes**. A mobile screen that does the right thing but renders with the
mobile-shared `Modal` (full-screen slide-up) instead of the web's centered-card modal is
**Partial**, not Present. The user has been explicit about this: "debería verse exatamente igual
en la app móvil" is a visual-axis requirement, not a nice-to-have.

This skill governs the *analysis* that makes parity measurable. It does **NOT** write mobile code
(that is `mobile-dev`), does **NOT** plan (that is `how-to-plan`), does **NOT** test (that is
`how-to-test`). It produces the **input** those skills consume. During the audit itself, work is
**read-only in both trees**.

## Core Rules

- **Read-only audit.** The audit phase reads `apps/frontend`, `apps/backend`, `libs/`, and
  `apps/mobile` — it writes **no source code**. The only artifact produced is the parity report
  (written under the scratchpad or a path the user names, never inside a skill folder).
- **Two-axis parity.** Each capability in the gap map is evaluated against BOTH the functional axis
  (does mobile *do* this?) AND the visual axis (does mobile *look like* the web when doing it?).
  Status `Present` requires both axes green. A functional-only match is `Partial`.
- **Compare capabilities, not files.** Web (`apps/frontend`) resolves surface by `app_type`
  (hostname) and module visibility via `panel_ui` / industry / permissions; mobile
  (`apps/mobile`) resolves surface by **expo-router route groups** (`(auth)`, `(org-admin)`,
  `(store-admin)`, `(super-admin)`) + `src/features`. Folder shapes differ — anchor every comparison
  on a **functional capability**, so "does mobile do X" is answerable regardless of file layout.
- **Establish the surface first.** Before inventorying, pin down which `app_type` / persona the web
  target lives in (STORE_ADMIN, ORG_ADMIN, SUPER_ADMIN, STORE_ECOMMERCE) and which mobile route
  group is its counterpart. A parity audit without a fixed surface produces noise.
- **Visual parity anchors on the Web Visual Pattern** (next section). When in doubt about "how
  should mobile look for this feature", the web pattern is the answer — not the mobile-shared
  components (which often default to full-screen and ignore the centered-card convention).
- **Granularity is the product.** A parity report that lists "Orders module: missing" is a failure.
  Enumerate to the level of individual **actions, form fields, validations, states, permissions,
  consumed endpoints, and visual treatment** (see the Capability Taxonomy). The report must be minute
  enough that a mobile dev can implement from it without re-reading the web source.
- **Backend is shared, not duplicated.** Both clients call the same backend. Inventory the **endpoints
  and DTO shapes** the web target consumes so the mobile side can reuse the exact contract — never
  propose re-implementing backend logic on mobile (`mobile-dev` RULE 6).
- **Visual copy is part of the contract.** Placeholder text, label text, toast strings, validation
  messages — these are NOT stylistic choices for mobile to localize freely. They are parity assets
  inherited from the web. Mobile must mirror them verbatim.
- **Every capability gets a status.** Each row in the gap map is exactly one of: `Present`,
  `Partial`, `Absent`, or `N/A-mobile` (a web capability that legitimately does not belong on mobile —
  justify why). No blanks.
- **The audit ends by handing off, not by coding.** Its terminal output is a gap map ready to feed
  `how-to-plan`. Writing mobile code from within this skill skips the plan gate.

## Web Visual Pattern (the visual anchor)

When the audit evaluates the **visual axis**, it anchors every check against the established web
visual pattern. This pattern is the structural + stylistic decisions the web team has converged on,
distilled from reference modals (`app-modal`, `app-button`, `app-input`, etc.) and screens.

### Modal anatomy (universal across quick-create / edit / detail modals)

The web's `app-modal` (size `sm` / `md` / `lg` / `xl`) renders a **centered, floating card** on a
semi-transparent backdrop — **never** a full-screen slide-up. Every web modal follows this exact
anatomy:

| Layer | What it is | Spec |
| --- | --- | --- |
| **Backdrop** | Screen-wide dim layer | `rgba(15, 23, 42, 0.45)` (slate-900 at 45%); tap closes modal |
| **Card wrapper** | Centering + max width | `max-width: 480px` for `md`; vertically centered |
| **Card** | The visible surface | White bg, `border-radius: var(--radius-lg)`, subtle shadow, 1px gray-200 border |
| **Header** | Title + close X | `flex justify-between`, title left (large semibold), X right; **NO** border-bottom (the footer is the visual separator) |
| **Body** | Form fields | 16px padding, 16px gap between fields |
| **Footer** | Actions | `border-top` 1px gray-200, padding 16px, **buttons right-aligned**, content-sized (NOT stretched to 100%), `space-x-3` between |

### Inputs (web `app-input` / `app-textarea` / `app-select`)

| Element | Spec |
| --- | --- |
| **Label** | `text-xs font-bold uppercase text-gray-700` + `letter-spacing: 0.5` |
| **Required indicator** | Red `*` immediately after the label |
| **Field wrapper** | `rounded-md` (or `rounded-lg` for textarea), `border-gray-300` default, primary-color focus ring |
| **Error display** | Inline below the field, red text — never a toast |
| **Placeholders** | Sentence-case imperatives in Spanish: "Ingresa el nombre de la marca", "Ingresa una descripción (opcional)" |

### Buttons (web `app-button`)

| Property | Spec |
| --- | --- |
| **Heights** | `sm` 32px, `md` 40px, `lg` 48px |
| **Variants** | `primary` (filled, white text), `outline` (transparent bg, colored border + text), `ghost` (no border), `destructive` (red filled) |
| **Footer rules** | outline + primary pair, content-sized (no `fullWidth` / `flex: 1`), right-aligned, `space-x-3` gap, `border-top` separator above |

### Toast strings (match verbatim)

| Case | Pattern |
| --- | --- |
| Success | `"<Entidad> creada exitosamente"` / `"<Entidad> actualizado"` — example: `"Marca creada exitosamente"` |
| Error | `"Error al <verbo> la <entidad>"` — example: `"Error al crear la marca"` |

### Validation messages (match verbatim)

| Validation | Web string |
| --- | --- |
| Required | `"Este campo es obligatorio"` |
| minLength | `"Mínimo N caracteres requeridos"` |
| maxLength | `"Máximo N caracteres permitidos"` |
| Invalid (generic) | `"Entrada inválida"` |

> **These are not stylistic suggestions — they are parity requirements.** When mobile renders a
> form modal that needs visual parity, it MUST use the centered-card anatomy (not the shared
> mobile `Modal` full-screen wrapper), MUST label inputs the same way, MUST button-layout the
> same way, and MUST toast/validate with the exact same strings.

**Code-level prescription**: Engram memory `#384 — Mobile Web Visual Parity Pattern (centered card
modal)` carries the full React Native impl (modal structure, RNModal transparent wrapper, backdrop
Pressable, KeyboardAvoidingView, cardWrapper with `maxWidth: 480`, header/body/footer styles, exact
Spacing & borderRadius tokens). Load it for any concrete mobile visual change.

## Workflow

Six phases. Phase 0 establishes the visual baseline; phases 1–5 are the audit (read-only); phase 6
is the handoff.

| Phase | Goal | Tools | Output |
| --- | --- | --- | --- |
| **0. Visual baseline** | Load the Web Visual Pattern + relevant Engram memories BEFORE reading any code | Read the "Web Visual Pattern" section above; `engram search "paridad visual" --project vendix` | Anchored understanding of the visual contract |
| **1. Scope** | Fix the web target + its `app_type`/persona + the mobile counterpart route group | Read, grep, AskUserQuestion if ambiguous | One-line scope statement + surface mapping |
| **2. Web inventory (functional + visual)** | Enumerate every capability of the web target using the Capability Taxonomy — both axes | Explore/Read, grep over `apps/frontend` + backend contracts | Granular capability list (the "web truth" — functional AND visual) |
| **3. Mobile inventory (functional + visual)** | Enumerate what `apps/mobile` already implements for the same surface, both axes | Explore/Read, grep over `apps/mobile` | Mobile capability list with explicit visual treatment per row |
| **4. Gap map** | Diff web vs mobile per capability, assign 2-axis status + priority | synthesis | Strategic gap map (the deliverable) |
| **5. Handoff** | Feed the gap map to planning/dev/test | how-to-plan, then how-to-dev + how-to-test | Approved mobile implementation plan |

- **Phase 0 is mandatory**: it loads the visual anchor the rest of the audit uses. The Web Visual
  Pattern section above is the canonical reference; Engram memory `#384` carries the full
  code-level prescription. Skipping this phase means auditing the visual axis in the dark.
- Phase 1 is mandatory and cannot be skipped. If the user's target is vague ("audit orders"),
  resolve *which* orders surface (store POS orders? org-admin orders list? ecommerce checkout?) before
  reading anything.
- Phases 2 and 3 are independent — run them as parallel `Explore` agents via `agent-teams` (one
  owns web, one owns mobile) and merge in phase 4. Cap at the `how-to-plan` limit of 3 parallel.
- **Each mobile find must include visual treatment**: when a mobile element is identified, the
  inventory must record what wrapper/style/icon/label/button layout it actually uses, so phase 4
  can detect visual drift (e.g. mobile using shared full-screen `Modal` vs the centered card).
- Phase 4 is pure synthesis: never re-open source to "double check" mid-diff; if the inventory is
  incomplete, return to phase 2/3, don't patch the map.
- Phase 5 is where `how-to-plan` takes over. The gap map becomes the plan's `Context` +
  `Specific Objectives`; each Absent/Partial capability (on either axis) becomes one or more plan
  Steps. Visual-partial rows in the gap map become plan steps with explicit visual acceptance
  criteria.

## Capability Taxonomy (what "granular" means)

For the web target, enumerate **every** applicable dimension below — for both axes (functional and
visual) where applicable. This taxonomy is the checklist that makes the inventory exhaustive —
omitting a dimension is how a parity audit silently misses work.

| # | Dimension | Axis | What to capture |
| --- | --- | --- | --- |
| 1 | **Navigation / routes** | functional | Every route, tab, nested view, and deep-link into the target; entry points from other modules |
| 2 | **Screens / views** | functional | Each distinct screen or panel; list view vs detail vs create/edit vs modal |
| 3 | **Actions / CTAs** | functional | Every button, menu item, row action, bulk action, gesture — what each triggers |
| 4 | **Forms & fields** | functional | Every field, its type, required/optional, default, and **validation rule** (client + server) |
| 5 | **States** | functional | empty, loading, success, error, partial, offline, skeleton, pagination-end — per view |
| 6 | **Data display** | functional | Tables/lists/cards, columns shown, sorting, filtering, search, pagination, grouping |
| 7 | **Permissions & gating** | functional | Required permissions, `panel_ui` visibility, industry gating, subscription/feature gates |
| 8 | **Consumed endpoints** | functional | Every backend endpoint the target calls, method, request DTO, response shape |
| 9 | **Side-effects** | functional | Notifications, journal entries, stock changes, prints, downloads, uploads, events fired |
| 10 | **Formatting concerns** | functional | Currency, dates/timezone, i18n strings, number/tax formatting the view relies on |
| 11 | **Cross-module dependencies** | functional | Shared components/services the target reuses (modals, selectors, pipes, guards) |
| 12 | **Edge cases & business rules** | functional | Illegal-state guards, race conditions, tenant scope, role-specific variants |
| **13** | **Visual & UX presentation** | **visual** | Structural anatomy (modal centered vs full-screen, list vs grid), labels (case/weight/spacing), button variants + alignment + sizing, color tokens, spacing tokens, shadow/radius, animations; check each item against the Web Visual Pattern |
| **14** | **Toast & feedback copy** | **visual** | Verbatim toast strings (success / error), inline error text, focus rings, hover states — exact strings, not summaries |
| **15** | **Validation message parity** | **visual** | Exact strings for required / minLength / maxLength / invalid; whether they appear inline or as toasts |

For each enumerated capability, record enough to implement: **name · trigger · behavior · endpoint
(if any) · permission/gate (if any) · visual treatment (if applicable)**. This is the level the
mobile dev must be able to build from.

## Deliverable — Parity Report format

The report is the single artifact this skill produces. Write it to the scratchpad (or a user-named
path), not into any skill folder. Use this exact structure:

```markdown
# Parity Audit — <web target> (<app_type / persona>)

## Visual Baseline Loaded
- Web Visual Pattern: <id from this skill + engram>
- Visual rules referenced: modal anatomy, input labels, button variants, toast strings, validation messages
- Date / engram revision: <timestamp + memory id>

## Scope
- Web target: <feature/module/flow> — `apps/frontend/src/app/private/modules/<...>`
- Surface / app_type: <STORE_ADMIN | ORG_ADMIN | SUPER_ADMIN | STORE_ECOMMERCE>
- Mobile counterpart: `apps/mobile/app/(<group>)/<...>` + `apps/mobile/src/features/<...>`
- Shared backend domain(s): `apps/backend/src/domains/<...>`

## Web Functional Inventory  <!-- granular, taxonomy-driven, dimensions 1-12 -->
### 1. Navigation / routes
- ...
### 2. Screens / views
- ...
<!-- ...every applicable taxonomy dimension through 12... -->

## Web Visual Inventory  <!-- dimensions 13, 14, 15 -->
### 13. Visual & UX presentation
- Modal anatomy: centered card on dimmed backdrop (per Web Visual Pattern)
- Labels: uppercase, semibold, gray-700, with red `*` for required
- Buttons: outline + primary pair, content-sized, right-aligned in footer, border-top separator
- ...
### 14. Toast & feedback copy
- Success: "<exact string>"
- Error: "<exact string>"
### 15. Validation message parity
- Required: "Este campo es obligatorio"
- minLength: "Mínimo N caracteres requeridos"
- maxLength: "Máximo N caracteres permitidos"

## Mobile Current State
- What exists today in apps/mobile for this surface — granular, with explicit visual treatment per row.

## Strategic Gap Map
| Capability | Web | Mobile (func) | Mobile (visual) | Status | Priority | Endpoint / gate | Visual notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| <capability> | ✅ | ❌ | — | Absent | P0 | `GET /store/orders` · perm `orders.read` | — |
| <capability> | ✅ | ✅ | ⚠️ (shared Modal full-screen vs centered card) | Partial | P1 | ... | swap to centered card pattern |
| <capability> | ✅ | ✅ | ✅ | Present | — | ... | parity reached |
| <capability> | ✅ | — | — | N/A-mobile | — | — | web-only bulk export; justify |

## Coverage Summary
- **Functional axis**: Present N/total · Partial N · Absent N · N/A N  →  <parity %> on capability
- **Visual axis**:     Present N/total · Partial N · Absent N · N/A N  →  <parity %> on look-and-feel
- **Combined**: <parity %> Present across both axes

## Recommended Sequencing (input to how-to-plan)
1. <Absent P0 capability (functional OR visual)> — why it goes first
2. <Partial P1 capability> — depends on #1
...
```

- **Status legend** is now **two-dimensional**:
  - `Present` = mobile matches on **both** functional AND visual axes
  - `Partial` = exists on mobile but is incomplete on at least one axis (functional OR visual)
  - `Absent` = not on mobile at all
  - `N/A-mobile` = intentionally web-only (must be justified)
- **Priority (P0–P2)** reflects business value + dependency order, not effort. Effort belongs in
  the plan, not the audit.

## Handoff to Plan / Dev / Test

The gap map is the bridge, not the destination. After the report:

1. **`how-to-plan`** — feed the gap map in. The report's `Scope` → the plan's `Context`; each
   Absent/Partial capability → one or more plan `Steps`; `Recommended Sequencing` → step order. Every
   plan step must list `mobile-dev` in `Skills` (mobile edits are exclusive to `apps/mobile/`), plus
   the domain skills the capability touches (e.g. `vendix-currency-formatting`, `vendix-permissions`).
   **Visual-partial rows** become plan steps with explicit visual acceptance criteria anchored on
   the Web Visual Pattern.
2. **`how-to-dev`** — execute the approved plan. `mobile-dev` is loaded first; all writes stay inside
   `apps/mobile/`; backend/frontend are read-only reference for contract alignment. Reference the
   Web Visual Pattern / Engram #384 as the visual source of truth for any visual-axis step.
3. **`how-to-test`** — verify each shipped capability. Mobile UI is verified on-device / in the Expo
   client. The **backend contract** is verified with `curl` (Happy / Sad / Brute-Force) — the
   endpoint is shared, so its parity is provable at the API layer. For visual parity, drive an
   automated UI snapshot diff between web and mobile-equivalent screens when feasible; in all
   cases, verify label text, toast strings, validation messages, and modal anatomy against the Web
   Visual Pattern.

## Decision Rules

| Situation | Do |
| --- | --- |
| User names a broad module ("audit inventory") | Phase 1: split into concrete surfaces/flows, confirm which one(s) to audit |
| Web target spans multiple `app_type`s | Audit one surface per report; do not blend STORE_ADMIN and ecommerce in one map |
| A web capability clearly makes no sense on mobile | Mark `N/A-mobile` **with a justification**, never silently drop it |
| Mobile has a capability web lacks | Note it as an inverse gap in `Notes`; the audit is web→mobile but record divergence |
| Mobile does X functionally but renders with the shared mobile `Modal` (full-screen) instead of the web centered card | Mark **Partial** on the visual axis and recommend the centered-card pattern; the visual axis is a parity axis, not a nice-to-have |
| Mobile uses the shared `Input` / `Textarea` (which already render uppercase labels + asterisk via the component's own styling) | Visual axis = **Present** for label treatment; do not over-engineer custom label renderers |
| Mobile label or placeholder diverges from the web's verbatim text | Mark **Partial** on the visual axis; the copy is part of the contract |
| Mobile toast/validation message text differs from the web's verbatim string | Mark **Partial** on the visual axis; fix the copy, not the component |
| Inventory feels "done" after the happy path only | Not done — the taxonomy's states/permissions/edge-cases rows are mandatory (and dimensions 13/14/15 are independent axes, never optional) |
| Ready to write mobile code | Stop. Hand off to `how-to-plan` first — this skill never writes source |
| Web and mobile call the same endpoint differently | Flag as `Partial`; contract drift is a parity defect |
| User asks specifically about visual parity ("look like the web", "debería verse exatamente igual", "paridad visual") | Treat as an explicit visual-axis drilldown: load the Web Visual Pattern + Engram #384, audit dimensions 13/14/15 first, then drop back to functional coverage |

## Anti-Patterns

| Anti-pattern | Correct alternative |
| --- | --- |
| Coarse gap map ("Orders: missing") | Enumerate to actions/fields/states/endpoints per the Capability Taxonomy |
| Comparing folder trees instead of capabilities | Diff functional capabilities; folder shapes differ by design |
| Auditing without fixing the `app_type` / surface first | Phase 1 pins the surface before any reading |
| Skipping Phase 0 (visual baseline) | Load the Web Visual Pattern + Engram #384 before any reading; the visual axis cannot be audited in the dark |
| Treating functional parity alone as `Present` | Functional parity is **Partial**, not Present; audit the visual axis (13/14/15) too |
| Defaulting to the mobile-shared `Modal` (full-screen) for "convenience" when mirroring a web modal | Use the Web Visual Pattern centered-card anatomy for any web-mirrored modal |
| Localizing label/placeholder/toast/validation copy on mobile | These are parity assets — mirror the web's verbatim strings |
| Writing mobile code from within the audit | Audit is read-only; code comes after `how-to-plan` approval under `how-to-dev` |
| Proposing to re-implement backend logic on mobile | Reuse the shared endpoint/DTO; `mobile-dev` RULE 6 forbids duplicating backend logic |
| Leaving a capability with no status | Every row is Present / Partial / Absent / N/A-mobile (on the functional axis AND, where applicable, the visual axis) |
| Dropping web-only capabilities silently | Mark `N/A-mobile` with a written justification |
| Reporting parity % off the happy path only | % is computed over the full taxonomy-driven inventory (both axes) |
| Re-planning inside the report | The report ends at the gap map + sequencing; `how-to-plan` owns the plan |
| Auditing only the functional rows when the user explicitly asked for visual parity | Treat the ask as a visual-axis drilldown; dimensions 13/14/15 are mandatory, not optional |

## Related Skills

- `mobile-dev` — **Required for the handoff.** Governs all mobile code (edits exclusive to
  `apps/mobile/`, other trees read-only). Loaded during phase 5 dev, not the audit.
- `how-to-plan` — Consumes the gap map to produce the mobile implementation plan.
- `how-to-dev` — Executes the approved plan under `mobile-dev`.
- `how-to-test` — Verifies each capability (curl for the shared backend contract; Expo client for
  UI; verbatim-string match against the Web Visual Pattern for visual-axis rows).
- `agent-teams` — Run the web inventory (phase 2) and mobile inventory (phase 3) as parallel agents.
- `vendix-app-architecture` — `app_type` / persona resolution; how web surfaces map to mobile groups.
- `vendix-panel-ui` — Web module visibility (industry / `panel_ui` / permissions) to inventory in
  dim 7.
- `vendix-permissions` — Permission requirements per capability (dim 7 of the taxonomy).
- `vendix-core` — Skill map by domain, to route each capability to its owning domain skill.
- `vendix-engram` — Persistent shared memory; `engram search "paridad visual" --project vendix`
  retrieves `vendix-core`-level references including `#384 — Mobile Web Visual Parity Pattern`
  (used to guide any concrete mobile visual change).

## Changelog

- **v1.1** — Added the Web Visual Pattern as the visual anchor (modal anatomy, inputs, buttons,
  toast strings, validation messages); added Phase 0 (Visual Baseline Loaded); added three new
  taxonomy dimensions: 13 (Visual & UX presentation), 14 (Toast & feedback copy), 15 (Validation
  message parity); promoted visual parity from implicit to an explicit, second axis in the gap map
  (status `Present` now requires both functional AND visual axes green; functional-only matches are
  `Partial`). Visual-only divergences (e.g. mobile using shared full-screen `Modal` instead of web
  centered card) are now flagged `Partial` with concrete remediation, not silently accepted.
  Auto-invoke triggers broadened to cover explicit visual asks. Decision Rules + Anti-Patterns
  extended to capture the visual-axis requirements. Engram `#384` cited as the code-level visual
  prescription.
- **v1.0** — Initial release. Five-phase read-only audit (Scope → Web inventory → Mobile inventory →
  Gap map → Handoff), 12-dimension Capability Taxonomy, Parity Report format with a
  Present/Partial/Absent/N/A gap map, and explicit handoff to how-to-plan → how-to-dev → how-to-test.
