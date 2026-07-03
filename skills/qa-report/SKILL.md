---
name: qa-report
description: >
  Author a sprint QA report as a self-contained, graphical HTML web presentation (a "slide deck")
  that summarizes bugs found by QA and tickets/flows validated within a time window, with charts,
  demonstrative listings, tasteful motion, and a prominent Critical/Urgent section. Data comes from
  one of two conversationally-negotiated paths: the QA user pastes the info as text, OR the agent
  autonomously queries Linear for the sprint window. Saved under docs/ and optionally published as a
  Claude Artifact.
  Trigger: Creating a QA sprint report as a web presentation, building an HTML slide-deck of bugs
  found and tickets validated in a sprint window, reporting QA results with charts and a
  critical/urgent section, or summarizing Linear bugs/validated tickets for a sprint into a visual
  report.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Creating a QA sprint report as a web presentation"
    - "Building an HTML slide-deck of bugs found and tickets validated in a sprint window"
    - "Reporting QA results with charts and a critical/urgent section"
    - "Summarizing Linear bugs and validated tickets for a sprint into a visual report"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# QA Report

## Purpose

Governs how an agent turns a sprint's QA activity into a **graphical web presentation** — a
self-contained HTML "slide deck" that reports, for a defined time window: the **bugs found by QA**,
the **tickets/flows validated**, the **temporal trend**, and — up front — the **critical/urgent
issues to address immediately**. The deck is charts + demonstrative listings + restrained motion,
readable from every angle (executive glance → per-issue detail).

Owns: the two data-intake paths and their conversational negotiation, the report's section model,
the KPI + chart vocabulary for QA data, the critical-section contract, the file location, and the
fillable template in `assets/`.

Does NOT own:
- The general artifact aesthetic and CSP/inline rules → `artifact-design` (load before writing/publishing).
- Chart form/color/encoding correctness → `dataviz` (load before choosing chart types and colors).
- Linear API plumbing, auth, and issue semantics → `linear-issues` / `linear-connect`.
- How a ticket was verified in prod (the verdicts this report aggregates) → `verify-ticket-prod` / `how-to-test`.
- Inventing QA facts, bugs, or metrics — every number traces to real data.

## Core Rules

1. **Conversational intake FIRST — never start building until the user has answered.** Ask, one
   question at a time (see Workflow step 1): (a) **which data path** — paste-text vs autonomous
   Linear search; (b) the **sprint window** as explicit start/end dates (convert any relative phrase
   like "este sprint" to absolute dates and confirm — see `vendix-date-timezone`); (c) the **sprint
   name/label** and audience; (d) what counts as a **"validated" ticket** (a Linear state, a label,
   or the paste-text list). Restate the collected scope in one line before proceeding.
2. **Two data paths, never invent data.**
   - **Path A — user pastes the info:** parse the text into the report model (bugs, severities,
     validated tickets, verdicts, dates). Do not add issues the user did not mention. Mark unknowns
     as "sin dato".
   - **Path B — autonomous Linear:** use the Linear plumbing from `linear-issues` (auth, constants)
     with the **date-windowed queries in `assets/linear-qa-queries.md`** to fetch bugs found,
     bugs resolved, and validated tickets in `[start, end]`. Filter client-side to the Vendix
     project. Every listed item cites its `QUI-x` id + URL. If `LINEAR_API_KEY`/`.linear/config.json`
     is missing, STOP and route to `linear-connect`.
3. **Output is ONE self-contained, CSP-safe HTML file.** Inline ALL CSS/JS; no external CDN scripts,
   no webfont URLs (use a system font stack — never risk a silent fallback), no remote images (embed
   as `data:` URIs). Charts are **inline SVG**, hand-rendered from a data object — no chart-lib CDN
   (blocked in Artifacts). Save to `docs/qa-report-<sprint>.html` (kebab-case) at the repo root;
   create `docs/` if missing. Same path on redeploy → same Artifact URL. **The run always ends by
   opening that file in the browser via the shell (`open docs/qa-report-<sprint>.html`)** — that
   launch is the deliverable (Workflow step 6).
4. **A prominent Critical/Urgent section is MANDATORY and appears near the top.** It lists blocker/
   high-severity bugs to address immediately, visually distinct (semantic critical red + a severity
   stripe), each with `QUI-x` + link + one-line impact + status. If there are none, say so explicitly
   ("Sin críticos abiertos en la ventana") — never omit the section.
5. **Data fidelity.** Every KPI and every chart value must trace to a real bug/ticket/count; every
   listed ticket links to Linear. No fabricated metrics, no rounded-for-looks numbers. If a figure is
   unknown, render "sin dato", not a guess.
6. **Charts follow `dataviz`; aesthetic follows `artifact-design`.** Load `dataviz` before choosing
   chart forms/colors: pick the form by the data's job (severity magnitude → bars; verdict/state
   composition → donut or stacked bar; trend over the window → line/area). **Semantic status colors
   (critical/warning/good/info) are reserved for severity/verdict and are NOT the deck's accent.**
   Legends present for ≥2 series; identity never color-alone.
7. **Theme-aware, responsive, accessible.** Style both light and dark via tokens (`prefers-color-scheme`
   + `data-theme` override, both directions). Body never scrolls horizontally; wide tables/charts get
   their own `overflow-x:auto`. Visible keyboard focus. `tabular-nums` for aligned figures.
8. **Motion is tasteful and gated.** Scroll-reveal of slides, count-up on KPI numbers, and a chart
   draw-in are allowed — ALL wrapped in `@media (prefers-reduced-motion: no-preference)` (and a JS
   `matchMedia` guard). Motion serves reading order; no ambient sparkle. Default (no-JS) state is
   fully visible.
9. **Spanish content** (Vendix convention); technical tokens (`QUI-x`, error codes, endpoints, dates)
   in a monospace face. The header always shows the **window dates + generation date + sprint name**.
10. **The most relevant tickets carry a plain-language "de qué trata" summary — not just a title.**
    Populate `REPORT.highlights` (the "Tickets destacados" section) with the sprint's key tickets,
    each with a 1–3 sentence summary of what it is about and why it matters, so a reader who did not
    live the sprint understands the substance. In Path B, take the summary from the Linear issue
    description/comments (do not invent); in Path A, from the user's text.
11. **Bar fills MUST be `display:block`.** The chart bars (`.bartrack` / `.barfill`) are `<span>`s and
    `width`/`height` do NOT apply to inline elements — a fill left inline collapses to an empty bar.
    The template sets `display:block` on both and renders the final width inline (JS only adds the
    optional grow animation). Do not remove `display:block` or revert to JS-only width.

## Report Section Model (the slides)

Fill these in order in `assets/qa-report-template.html`:

1. **Portada** — sprint name, window `[inicio → fin]`, fecha de generación, autor QA, one-line scope.
2. **Resumen ejecutivo (KPI row)** — tiles: bugs encontrados, bugs resueltos, tickets validados,
   críticos abiertos, tasa de aprobación (validados OK / total validados). Each tile = number +
   label + tiny delta/context.
3. **🔴 Críticos / Urgentes** — the mandatory immediate-action list (Rule 4).
4. **Tickets destacados — de qué tratan** — the most relevant tickets of the sprint, each with a
   short **plain-language summary of what it is about and why it matters** (not just the title), its
   kind (bug bloqueante / validado OK / no cumple / con defectos), area (módulo · tienda), and a link.
   This is what lets a reader who did not live the sprint understand the substance (Rule 10).
5. **Bugs encontrados** — severity distribution (bars), by módulo/app (bars), by estado (donut);
   + a demonstrative listing (id, título, módulo, severidad pill, estado, link).
6. **Tickets / flujos validados** — verdict composition (donut/stacked: OK / con defectos / no
   cumple / bloqueado — aligned with `verify-ticket-prod` verdicts) + a listing with verdict pills.
7. **Tendencia temporal** — bugs found vs resolved across the window (line/area), open-vs-closed.
8. **Distribución** — by módulo, tienda/industria (the demo test-bench stores), or assignee.
9. **Cierre** — conclusiones + próximos pasos / riesgos abiertos.

Scale the deck to the data: omit a section that has no data rather than pad it (but never omit
Critical/Urgent — state it as empty).

## Workflow

1. **Negotiate intake (conversational, one question at a time).**
   - "¿Me pasás la info del sprint en texto, o busco todo en Linear por ventana de fechas?"
   - "¿Cuál es la ventana del sprint? (fechas de inicio y fin)" → convert relative → absolute, confirm.
   - "¿Nombre del sprint y para quién es el reporte?"
   - "¿Qué cuenta como ticket *validado* — un estado de Linear, una etiqueta, o la lista que me pases?"
   - Restate the scope in one line and wait for "ok".
2. **Gather data.**
   - Path A: parse the pasted text into the model; confirm the parsed counts back to the user.
   - Path B: run the date-windowed queries (`assets/linear-qa-queries.md`) via the `linear-issues`
     plumbing; filter to Vendix; assemble bugs + validated tickets with ids/urls/severities/verdicts.
3. **Structure + compute.** Map data into the Section Model; compute KPIs and each chart series.
   Identify the critical set (severidad `Bloqueante`/`Alta` still open, or user-flagged urgent).
4. **Build the deck.** Load `artifact-design` (aesthetic + CSP) and `dataviz` (chart forms/colors).
   Copy `assets/qa-report-template.html` → `docs/qa-report-<sprint>.html` and fill: header/meta, KPI
   tiles, critical list, charts (inline SVG from the data object), listings, closing.
5. **Verify.** Open in a browser (or publish) and confirm: Critical section present, charts render
   with correct values + legends, no external-resource requests in the console, reduced-motion
   disables animation, mobile has no horizontal body scroll, both themes legible, every ticket links
   to Linear.
6. **Deliver — OPEN it for the user.** The final deliverable is to **launch the presentation in the
   browser via the shell**, so the QA user sees it immediately without hunting for the file:
   ```bash
   open docs/qa-report-<sprint>.html
   ```
   Run this `open` command as the last action (macOS/darwin). Then return a one-paragraph summary
   highlighting the critical count and the file path. Optionally also publish with the Artifact tool
   for a shareable link (same file path on redeploy) — but opening the local file is the required
   final step.

## Decision Rules

| Situation | Use |
| --- | --- |
| User hasn't chosen a data path or window yet | STOP and ask conversationally (Workflow step 1) — do not start |
| User pastes the QA info as text | Path A — parse into the model, confirm counts, never add issues |
| User wants the agent to find it | Path B — `assets/linear-qa-queries.md` + `linear-issues` plumbing, filter to Vendix |
| `LINEAR_API_KEY` / `.linear/config.json` missing (Path B) | STOP → `linear-connect` |
| Choosing a chart form or its colors | Load `dataviz`; form by data job; status colors reserved |
| Writing/publishing the HTML | Load `artifact-design`; self-contained + CSP-safe; save under `docs/` |
| Relative window phrase ("este sprint", "última semana") | Convert to absolute dates + confirm (`vendix-date-timezone`) |
| Aggregating how tickets were verified in prod | Verdicts come from `verify-ticket-prod` / `how-to-test` |
| Publishing as a shareable link | Artifact tool, same file path → same URL |

## Anti-Patterns

| Anti-pattern | Correct alternative |
| --- | --- |
| Starting to build before asking path + window | Negotiate intake first, one question at a time |
| Inventing bugs, counts, or "typical" metrics to fill charts | Only real data; unknowns render "sin dato" |
| Omitting the Critical section when there are no criticals | Keep it, state "Sin críticos abiertos en la ventana" |
| Linking a chart-lib or webfont CDN | Inline SVG charts + system font stack; CSP blocks CDNs in Artifacts |
| Using the accent hue for severity/verdict | Reserve semantic status colors; accent is structural only |
| Numbers that don't trace to a ticket | Every value maps to a real issue; tickets link to `QUI-x` |
| Motion with no reduced-motion guard | Gate all animation behind `prefers-reduced-motion` |
| Scattering the file in scratchpad or app source | `docs/qa-report-<sprint>.html` at the repo root |

## Templates

- `assets/qa-report-template.html` — full, fillable self-contained deck: light/dark design tokens,
  sticky section nav, KPI tile row, mandatory Critical/Urgent section with severity stripes, a
  "Tickets destacados — de qué tratan" card grid (`REPORT.highlights`, each with a plain-language
  summary), inline-SVG chart components (severity bars, verdict donut, temporal line) rendered from a
  single `REPORT` data object, demonstrative listings with severity/verdict pills, scroll-reveal +
  count-up motion (reduced-motion gated). Bar fills use `display:block` (Rule 11). Copy → rename →
  replace the `REPORT` object.
- `assets/linear-qa-queries.md` — date-windowed Linear GraphQL for Path B: bugs found, bugs
  resolved, and validated tickets in `[start, end]`; curl + `jq` pipeline to emit a `report.json`
  the template consumes; pagination + rate-limit + client-side Vendix filter notes.

## Related Skills

- `artifact-design` - Aesthetic + CSP/inline rules for the HTML (load before writing/publishing).
- `dataviz` - Chart form/color/encoding correctness (load before building any chart).
- `linear-issues` - Linear API plumbing, constants, auth, and issue semantics for Path B.
- `linear-connect` - Bootstraps `LINEAR_API_KEY` / `.linear/config.json` when missing.
- `verify-ticket-prod` / `how-to-test` - Produce the validation verdicts this report aggregates.
- `vendix-date-timezone` - Correct handling of the sprint window dates.
- `user-story-flows` - Sibling skill; the same self-contained-HTML-artifact-under-docs/ pattern.
- `skill-sync` - Run after creating/editing this skill to regenerate provider copies + AGENTS.md.
