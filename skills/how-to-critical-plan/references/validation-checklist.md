# Validation Checklist & Anti-Patterns

Load this when running the Contract Sweep Gate, the pre-approval pass (Phase 6), or the pre-"done" pass (Phase 7 exit) on a critical-plan bundle: which checks `cp-lint.sh` decides mechanically, which ones still need a human, and the anti-patterns that void a plan regardless of what the linter says. It replaces the v1.1 **Critical Plan Validation Checklist**.

## Mechanical checks — run `cp-lint.sh <bundle>`

Every rule below is enforced by `cp-lint.sh` (rule codes are the ones `cp-lint.sh` prints in its `LINT FAIL` lines). `cp-lint.sh` must exit 0 before a plan is approved, before a convergence round is recorded, and before the plan is declared done.

| v1.1 checklist item (now mechanical) | Lint rule |
|---|---|
| All mandatory sections/fragments exist, in order | L02 (`PLAN.md`'s 16 H2 in order + 4 markers), L03 (bundle directories/files exist) |
| No ad-hoc sections were added | L02 |
| `Non-Goals` section is present | L02 |
| `Plan Identity` fields present (hub frontmatter: `id,title,criticality,owner,created,updated,status,issue`) | L01 |
| All twelve step fields present, in order | L04 |
| Step `Status` line's first word matches the frontmatter `status` | L04 |
| `Contracts touched` / step `contracts` ids exist in their registry | L20 |
| ADRs referenced by a step (`adrs`) exist in `adr/` | L21 — *new; mechanizes "preserve every ADR" from Relationship With Development* |
| Findings referenced in a checklist exist in `findings/`; each open/fixed finding with an owning step appears exactly once in that step's checklist | L22 — *new; mechanizes the Convergence Loop's "file each finding as a checklist item" rule* |
| Budgets: bytes per fragment, chars per registry/log row, chars per checklist item | L10 — *new in v2.0; v1.1 had no size limit — this is why the format was split* |
| No `/tmp/` evidence paths anywhere in the bundle | L23 — *new in v2.0* |
| IDs unique across steps, ADRs, findings, and each registry | L24 |
| All thirteen perspectives appear in the Perspective Audit Matrix | L25 |
| ADR / finding frontmatter complete, ids match filenames, vocabularies valid (`status`, `severity`, `reversibility`, `perspective` ∈ 1..13, `accepted ⇒ accepted_by ≠ none`) | L05, L06 |

## Human-judgment checks

No script can decide these. Keep them as `- [ ]` items and run them before `## Approval Request` (Phase 6) and before the plan is declared done (Phase 7 exit). Groups follow the v1.1 checklist.

### Structural

- [ ] `Criticality Justification` quotes the explicit user request that invoked this skill, and names the risk signals that justify the weight.
- [ ] `Blast Radius` rows (plan-level and per-step) name a concrete wrong outcome and a detection signal — never "could cause issues".
- [ ] At least one ADR exists, and every ADR's `Reversibility` is filled with a real answer, not a placeholder.

### Contracts

- [ ] Registry row counts (`registry/fb.md`, `registry/db.md`, `registry/err.md`) equal the touched-point counts found in Phase 2 — a shrinking registry means something was dropped, not that the work got smaller.
- [ ] Every `withoutScope()` in a `DB-*` row has a written justification; unjustified is a `blocker` by definition.
- [ ] Every `DB-*` row states an invariant, or states why there is none.
- [ ] No step introduces a `throw new Error()` that can reach a controller.
- [ ] Every registry `Verification` is a runnable command, not a description.
- [ ] Every failure path introduced by the plan has an `ERR-*` row with an HTTP status and a frontend behavior (no lint rule covers this).

### Per-Step

- [ ] `Skills` on every step passes `how-to-plan`'s Skill Selection Matrix (inherited unchanged).
- [ ] Per-field acceptance bars (`Data impact` quantified, `Rollback` exact, `Acceptance checklist` granularity, `Status` owner+date) hold — see `references/format.md` § Field-by-Field Rigor.

### Data integrity

- [ ] Every row-mutating migration carries a `-- DATA IMPACT:` header.
- [ ] Incoming foreign keys were identified and handled with the safe pattern; no `CASCADE`, no `TRUNCATE CASCADE`, no `DROP TABLE`, no unqualified `DELETE` / `UPDATE`.
- [ ] A production snapshot is recorded as taken before any destructive step.
- [ ] The dry-run ran against a representative dataset, not an empty database.

### Audit & convergence

- [ ] Every `N/A` in the Perspective Audit Matrix carries a written reason.
- [ ] The second clean round varied its entry points (`log/convergence.md` records which variation) — see `references/perspectives.md`.

### Living document

- [ ] `**Handoff notes:**` in the hub says what the next person needs; never left as `—` once execution starts.
- [ ] Every `[x]` line points to evidence (`evidence/...`, commit sha, or PR URL) — a tick without evidence is a tick for typed code.


## Anti-Patterns

| Anti-pattern | Correct alternative |
|--------------|---------------------|
| A registry row saying "and the other 20 endpoints follow the same pattern" | 20 more rows. Completeness is the whole point of the registry. |
| Ticking `- [x]` because the code was written | `- [x]` means the `Verification` ran and passed. Attach the evidence. |
| Filling the contract registries after the code was written | Phase 2 precedes design on purpose. A retroactive registry documents what was built, not what should have been. |
| Verifying a contract with `tsc` or a build | A build proves the code agrees with the declared type. Only a live response proves the server agrees. |
| Closing a convergence round by downgrading a `blocker` to `minor` | Fix it, or record a `- [-]` with the human who authorized accepting it. |
| One clean round and calling the loop closed | Two consecutive clean rounds, with varied entry points on the second. |
| Deduplicating findings against the fixed list | Deduplicate against everything seen. Otherwise rejected-but-real findings reappear forever. |
| Executing several steps and updating the plan at the end | The plan is updated as you go. A plan updated in bulk is a plan that was never a handoff artifact. |
| Deleting a resolved blocker line from the ledger | Move it to the `Execution Log` with its resolution. The history is evidence. |
| `withoutScope()` in a `DB-*` row with no justification | Write why the tenant filter is bypassed and what replaces it. Unjustified is a `blocker`. |
| A perspective agent that writes code | Perspectives investigate and report. Fixes become plan steps with the full twelve fields. |
| A perspective agent returning "no issues found" without an attack narrative | Re-run it with an adversarial prompt. A perspective that did not try to break anything did not run. |
| Marking a perspective `N/A` silently | `N/A` needs a written reason, reviewable by the human. |
| Invoking this skill because the work *looks* critical, without the user asking | Explicit invocation only. Name the risk in one sentence, continue under `how-to-plan`, let the human decide. |
| Blocking the work to ask "should this be a critical plan?" | Suggest and keep planning. A question that stops delivery is worse than a plan the human upgrades later. |
| Using this skill for a two-file feature | Use `how-to-plan`. Over-escalation trains people to skim checklists, which is how the next real critical plan fails. |
| A `Blast radius` of "could cause issues" | Name the concrete wrong outcome, who sees it, and how it is detected. |
| Replanning mid-execution because a step "seems suboptimal" | Stop and ask the human. Global rule 1.3 forbids silent replan; here it also invalidates the audit trail. |
| A finding's full rationale pasted into a step's checklist item | File it in `findings/F-nnn.md`; the step keeps one line: `- [ ] F-nnn — <title> (<sev>)`. |
| Adding a second `[x]` line to close a `[ ]` finding line | Flip the mark on the same line. A finding occupies exactly one checklist line, ever. |
| A narrative Execution Log row | Rows are ≤ 300 chars. Put the detail in `evidence/` and link it. |
| Evidence paths under `/tmp` | Evidence always lives in `evidence/` inside the bundle. `/tmp` is wiped and invisible to the next reader. |
| Hand-editing between the ledger or index markers | Run `cp-ledger.sh`. Hand edits are overwritten and silently lost on the next regeneration. |
| Giving a perspective agent the whole bundle | `cp-context.sh <bundle> perspective <n> <step-ids…>` — only its slice, never the whole plan. |
