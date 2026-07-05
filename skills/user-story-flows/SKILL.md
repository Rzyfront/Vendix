---
name: user-story-flows
description: >
  Authoring user stories as self-contained, animated HTML flow artifacts saved under docs/ at the repo root.
  Trigger: When documenting user stories, drawing user-story flow diagrams, or producing a graphical
  view of a feature's flows to save in docs/ and optionally publish as a Claude Artifact.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Documenting user stories or writing HU-X.Y stories for a feature"
    - "Drawing graphical user-story flow diagrams (nodes, branches, states)"
    - "Saving user-story artifacts as HTML under docs/ at the repo root"
    - "Producing an animated flow view of a feature to share as a Claude Artifact"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# User Story Flows

## Purpose

Governs how to turn a feature into **user stories with a graphical, animated flow view**,
authored as a **single self-contained HTML file saved under `docs/` at the repo root** and
optionally published as a Claude Artifact for a shareable link. The flow is **always delivered as
that HTML view opened in the browser — never as text, ASCII, or a list in the conversation** — and
its steps are **granular enough that anyone, technical or not, can follow them** (see Core Rules).

Owns: the story taxonomy (epics → `HU-X.Y`), the flow-diagram vocabulary (node types,
connectors, branches, state pills), the animation contract, the file location, and the
ready-to-fill templates in `assets/`.

Does NOT own: what the flows should say (that comes from the real implementation and, when
economically relevant, from `vendix-business-analysis`), nor the general artifact aesthetic
(that is the bundled `artifact-design` skill — this skill applies its CSP/inline rules).

## Core Rules

> **HARD RULE — HIGHEST PRIORITY: the deliverable is the opened HTML view, NEVER text.** Do not draw
> the flow, the steps, or the stories as chat text, ASCII, a markdown list, or a code block — not even
> a "quick summary" or "preview" before building. The one and only deliverable is the self-contained
> HTML artifact, **built and then opened in the browser via the shell** (`open
> docs/<feature>-user-stories.html`) so the user sees it immediately. If you need to confirm scope
> first, ask a short question in words — but the *flow itself* is always delivered as the opened web
> view, never rendered in the conversation.

1. **One file per feature, under `docs/` at the repo root**: `docs/<feature>-user-stories.html`
   (kebab-case, e.g. `docs/memberships-user-stories.html`). Create `docs/` if it does not exist.
   Never scatter these in scratchpad or app source.
2. **Self-contained and CSP-safe** (so the same file publishes cleanly as an Artifact): inline
   ALL CSS and JS; no external CDN scripts, no webfont URLs, no remote images — embed assets as
   `data:` URIs. No `<!DOCTYPE>/<html>/<head>/<body>` when handing to the Artifact tool (it wraps
   the body); when saving a stand-alone file for `docs/`, a minimal wrapper is fine.
3. **Flows encode the REAL implementation, not decoration.** Every node maps to an actual
   action, endpoint, guard, event, or state. Derive states/transitions/endpoints from the code
   (grep the controllers/DTOs/services) — do NOT invent. A flow that cannot be traced to code is
   an open question, not a diagram.
4. **Ground state colors in the product's real palette.** Reuse the status hex the app already
   renders (e.g. active/pending/denied/frozen/expired badges) so the diagram is faithful
   documentation. Semantic state color is separate from the structural accent (see `artifact-design`).
5. **Stories are numbered because they are a real taxonomy** (`HU-X.Y`), not for decoration.
   Each story is one line: *"Como `<actor>` quiero `<capacidad>` para `<beneficio>`"*.
6. **Animations are mandatory but restrained and accessible.** Include: scroll-reveal of nodes,
   a flowing connector, and a subtle pulse on live state pills. ALL motion MUST be gated behind
   `@media (prefers-reduced-motion: no-preference)` (or the JS guard). Motion serves the flow
   reading direction — it is not ambient sparkle.
7. **Responsive**: each flow lives in an `overflow-x: auto` track that scrolls horizontally on
   desktop and collapses to a vertical stack (arrows point down) on narrow screens. The page body
   never scrolls sideways.
8. **Spanish content** (Vendix convention); technical tokens (endpoints, codes, field names) in a
   monospace face.
9. **Granular, step-by-step, understandable by anyone.** Break every flow into the smallest
   meaningful steps a real user/system takes — no step-skipping, no "etc.". Each node is one concrete
   action or system response, in order, so a non-technical reader can follow it start to finish.
   Include: the trigger, each screen/action the actor performs, each system/endpoint response, every
   decision with ALL its branches (happy, sad, edge), the resulting state, and any error outcome.
   Add a short plain-language caption to each node explaining *what happens and why* in everyday
   words; keep the technical token (endpoint/code/field) alongside in mono for the engineer. Prefer
   more, smaller nodes over few dense ones — granularity is the point.

## Creation Workflow

1. **Scope the feature.** If it touches revenue/billing/pricing/inventory/accounting/payments,
   run `vendix-business-analysis` first to confirm actors, rules, and acceptance criteria.
2. **Enumerate epics → stories.** Group stories into epics; give each story an `HU-X.Y` id and the
   *"Como … quiero … para …"* line. Keep one screen/surface per epic when possible.
3. **Derive each flow from the code.** For every story, read the real controllers, DTOs, guards,
   events, and status enums. Capture: entry action → system/endpoint steps → decision branches →
   resulting states/errors. Note the evidence (endpoint, error code, guard) for each node.
4. **Copy the template** `assets/flow-artifact-template.html` to
   `docs/<feature>-user-stories.html` and fill: header/meta, sticky nav, legend, one section per
   epic, one story card per `HU-X.Y` with its flow, and evidence chips.
5. **Verify.** Confirm: flows read L→R, branches render, animations run, reduced-motion disables
   them, mobile collapses to vertical, no external-resource requests in the console.
6. **Deliver — OPEN it for the user.** The final deliverable is to **launch the artifact in the
   browser via the shell**, so the user sees it immediately without hunting for the file:
   ```bash
   open docs/<feature>-user-stories.html
   ```
   Run this `open` command as the last action (macOS/darwin), then report the file path.
7. **(Optional) Publish** with the Artifact tool for a shareable link; keep the same file path so
   redeploys hit the same URL. Load `artifact-design` before publishing.

## Flow Diagram Vocabulary

| Node | Class | Use | Style cue |
| --- | --- | --- | --- |
| Action | `.node.action` | An actor does something | solid ink border + mono tag "ACCIÓN" |
| System | `.node.system` | Backend / endpoint / service step | accent-tint bg, endpoint in mono |
| Decision | `.node.decision` | A branch / validation | dashed border + "◇ DECISIÓN" |
| Branch group | `.branch` + `.branch-item` + `.cond` | The 2–4 outcomes of a decision | stacked pills, each with a mono condition label |
| State pill | `.pill.s-active\|s-pend\|s-deny\|s-froz\|s-exp` | A resulting entity state | semantic-colored pill |
| Error | `.pill.s-deny` w/ code | A real HTTP error outcome | red pill + code in mono |
| Connector | `.connector` | Directional link between nodes | flowing comet + chevron |

## Animation Contract

- **Scroll-reveal**: an `IntersectionObserver` adds `.in` to each `.story` (and staggers its
  children via `--i`); nodes fade + translate up. Default state without JS = visible.
- **Flowing connector**: `.connector::after` is a short bright segment that translates along a
  faint base line (`::before`), giving a "current flowing" read in the arrow direction.
- **Live-state pulse**: `.pill.s-active` / `.pill.s-pend` get a soft, slow box-shadow pulse.
- **Guard**: wrap every keyframe-driven rule in `@media (prefers-reduced-motion: no-preference)`
  and make the JS check `matchMedia('(prefers-reduced-motion: reduce)')` before observing.

## Decision Rules

| Situation | Use |
| --- | --- |
| Documenting user stories / drawing their flows | This skill + `assets/flow-artifact-template.html` |
| Feature affects money/stock/accounting/billing | Run `vendix-business-analysis` first, then this skill |
| About to publish the HTML as a shareable link | Load `artifact-design`, then the Artifact tool |
| Need the real states/endpoints for a flow | Grep the backend controllers/DTOs/enums; never invent |
| Choosing state colors | Reuse the app's real status palette; ask `vendix-frontend-theme` if unsure |
| Node type / connector / branch snippet | `assets/flow-components-reference.md` |
| Turning approved stories into an implementation plan | `how-to-plan` |

## Templates

- `assets/flow-artifact-template.html` — full, fillable page: design tokens, sticky nav, legend,
  animations (scroll-reveal + flowing connector + pulse), and one worked example epic showing
  every node type and a decision branch. Copy → rename → fill.
- `assets/flow-components-reference.md` — copy-paste snippets for each node type, connector,
  branch group, and state pill, with the animation hooks and when to use each.

## Related Skills

- `artifact-design` - Aesthetic + CSP/inline rules for the HTML (load before publishing as Artifact).
- `vendix-business-analysis` - Produces the confirmed actors/rules/acceptance the stories encode.
- `how-to-plan` - Consumes approved stories to build the implementation plan.
- `vendix-frontend-theme` - Source of the real status palette to ground state colors.
- `skill-sync` - Run after creating/editing this skill to regenerate provider copies + AGENTS.md.
