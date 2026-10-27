---
name: qa-report
description: >
  Build a sprint QA report as a self-contained animated HTML slide deck (bugs found, tickets
  validated, charts, Critical/Urgent section) from pasted text or Linear. Trigger: /qa-report, QA
  sprint report, reporte de QA.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke:
    - "Creating a QA sprint report as a web presentation"
    - "Building an HTML slide-deck of bugs found and tickets validated in a sprint window"
    - "Reporting QA results with charts and a critical/urgent section"
    - "Summarizing Linear bugs and validated tickets for a sprint into a visual report"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
disable-model-invocation: true
---

# QA Report

Sprint QA report as one self-contained, animated HTML slide deck: bugs found, tickets validated,
trend, and a Critical/Urgent section up front. Data from pasted text or Linear. Verdicts come from
`verify-ticket-prod` / `how-to-test`; Linear plumbing from `linear-issues`.

## 1. Intake (conversational, before building)

Ask one question at a time, then restate the scope in one line:
1. Data path: pasted text (A) or autonomous Linear search (B).
2. Sprint window as absolute start/end dates (convert "este sprint"; `vendix-date-timezone`).
3. Sprint name and audience.
4. What counts as validated. Default:

| Bucket | Linear signal |
| --- | --- |
| Validado | `Done` (QA verified in prod) |
| Rebotado por QA | label `Devuelto` (back to `Todo`, priority Alta) — report apart from new bugs |
| Esperando QA | `In Review` (already in prod) |
| En code review | `Code Review` + `Aprobado` / `Requiere cambios` |

- **A:** parse the text; never add issues the user did not mention; unknown = "sin dato".
- **B:** date-windowed queries in `assets/linear-qa-queries.md`, filtered to the Vendix project; every
  item cites `QUI-x` + URL. Missing key/config → `linear-connect`.

## 2. User stories in the report (mandatory)

Every validated or highlighted ticket shows, in plain language:
- **Historia:** "Como <rol> en <entorno>, quiero <funcionalidad> para <resultado>".
- **Pasos** the person/agent followed on screen.
- **Esperado vs. observado.**
Take them from the ticket / `verify-ticket-prod` report (B) or the user's text (A). If a ticket has no
story, infer it, mark it "(inferida)", never invent results. Technical detail goes below.
Template fields: `REPORT.highlights[].story`, `.steps[]`, `.expected`, `.observed`.

## 3. Output rules

- One HTML file, all CSS/JS inline, system font stack, no CDN/webfonts/remote images (`data:` URIs),
  charts as inline SVG from the `REPORT` object. Save `docs/qa-report-<sprint>.html` (kebab-case).
- **Critical/Urgent section mandatory and near the top:** open Bloqueante/Alta bugs or user-flagged,
  each with `QUI-x` + link + one-line impact + state. None → "Sin críticos abiertos en la ventana".
- Data fidelity: every KPI and chart value traces to real tickets; unknown = "sin dato"; no rounding for looks.
- Charts: load `dataviz` first. Severity → bars; verdict/state composition → donut/stacked; trend →
  line. Status colors (critical/warning/good/info) reserved for severity/verdict, never the accent.
  Legends for ≥2 series; never color alone.
- Light + dark via tokens (`prefers-color-scheme` + `data-theme`); no horizontal body scroll; visible
  focus; `tabular-nums`.
- Motion (scroll-reveal, count-up, chart draw-in) only inside
  `@media (prefers-reduced-motion: no-preference)` + JS `matchMedia` guard; no-JS state fully visible.
- Spanish content; `QUI-x`, codes, endpoints, dates in monospace. Header: window, generation date, sprint.
- Bar fills (`.bartrack` / `.barfill` are `<span>`) keep `display:block` with the final width inline,
  or bars collapse to empty.

## 4. Sections (omit empty ones except Critical)

Portada → KPIs (encontrados, resueltos, validados, críticos abiertos, tasa de aprobación) → Críticos →
Tickets destacados (historia, pasos, esperado vs. observado, resumen de qué trata y por qué importa) →
Bugs (severidad, módulo, estado + listado) → Validados (veredictos de `verify-ticket-prod` + listado) →
Tendencia (encontrados vs. resueltos) → Distribución (módulo, tienda demo, responsable) → Cierre.

## 5. Build and deliver

1. Copy `assets/qa-report-template.html` → `docs/qa-report-<sprint>.html`; replace the whole `REPORT` object.
2. Verify in a browser: Critical present, chart values and legends correct, no external requests in
   console, reduced-motion disables animation, mobile without horizontal scroll, both themes legible,
   every ticket links to Linear.
3. Last action: `open docs/qa-report-<sprint>.html`. Reply with the critical count and the path.
