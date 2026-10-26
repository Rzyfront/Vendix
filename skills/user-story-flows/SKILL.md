---
name: user-story-flows
description: >
  Author user stories as self-contained animated HTML flow artifacts under docs/. Trigger:
  /user-story-flows, documenting user stories, user-story flow diagrams, graphical view of a feature's
  flows.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke:
    - "Documenting user stories or writing HU-X.Y stories for a feature"
    - "Drawing graphical user-story flow diagrams (nodes, branches, states)"
    - "Saving user-story artifacts as HTML under docs/ at the repo root"
    - "Producing an animated flow view of a feature to share as a Claude Artifact"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
disable-model-invocation: true
---

# User Story Flows

Turns a feature into user stories with an animated flow view: **one self-contained HTML file per
feature under `docs/`**, opened in the browser. What the flows say comes from the real code (and
`vendix-business-analysis` when money/stock/billing is involved).

## Hard rule

The deliverable is the opened HTML, **never** chat text, ASCII, markdown lists or a "preview". Ask
scope questions in words if needed, but the flow itself only exists in the file, opened with
`open docs/<feature>-user-stories.html` as the last action.

## Story format

- Epics → stories with id `HU-X.Y`.
- Each story: "Como <rol> en <entorno>, quiero <funcionalidad> para <resultado>".
- Each story has the steps a person follows on screen (the flow nodes) and **observable acceptance
  criteria** (what the person sees: message, row, total, state badge) in `.acceptance`.
- Technical tokens (endpoint, guard, error code, field) go alongside in monospace, never instead of
  the plain-language caption.

## Rules

1. File: `docs/<feature>-user-stories.html` (kebab-case); create `docs/` if missing; never in app
   source or skill folders.
2. Self-contained, CSP-safe: all CSS/JS inline, no CDN, webfonts or remote images (`data:` URIs). For
   the Artifact tool drop the `<!DOCTYPE>/<html>/<head>/<body>` wrapper.
3. Flows encode the **real implementation**: every node maps to an action, endpoint, guard, event or
   state found in controllers/DTOs/services/enums. Untraceable = open question, not a node.
4. State colors reuse the app's real status palette (`vendix-frontend-theme`), separate from the accent.
5. Granular: one concrete action or system response per node, every decision with all branches (happy,
   sad, edge), resulting state and error outcome, each with a plain-language caption. More small nodes
   beat few dense ones.
6. Motion (scroll-reveal, flowing connector, pulse on live pills) only inside
   `@media (prefers-reduced-motion: no-preference)` + JS `matchMedia` guard; no-JS state visible.
7. Responsive: each flow in an `overflow-x: auto` track; vertical stack on narrow screens; the body
   never scrolls sideways.
8. Spanish content.

## Workflow

1. Scope the feature (`vendix-business-analysis` first if it touches money/stock/accounting/billing).
2. Epics → `HU-X.Y` stories with story line, on-screen steps and acceptance criteria.
3. Derive each flow from code: entry action → endpoint/system steps → decisions → states/errors, with
   evidence (endpoint, error code, guard) per node.
4. Copy `assets/flow-artifact-template.html` → `docs/<feature>-user-stories.html` and fill it.
   Snippets per node type: `assets/flow-components-reference.md` (read on demand).
5. Verify: L→R reading, branches render, animations run and stop under reduced-motion, mobile
   collapses, no external requests in console.
6. `open docs/<feature>-user-stories.html`; report the path. Optional: publish with the Artifact tool
   (same path → same URL).

Node vocabulary: `.node.action` (actor), `.node.system` (endpoint/service), `.node.decision` +
`.branch`/`.branch-item`/`.cond` (outcomes), `.pill.s-active|s-pend|s-deny|s-froz|s-exp` (states,
`s-deny` + code for HTTP errors), `.connector` (flow).

## Related Skills

`vendix-business-analysis` (actors, rules, acceptance) · `how-to-plan` (stories → `odd/tasks/<feature>.md`) ·
`vendix-frontend-theme` (status palette) · `qa-report` (same self-contained HTML pattern).
