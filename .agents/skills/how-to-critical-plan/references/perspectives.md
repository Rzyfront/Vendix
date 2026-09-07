# The Perspective Fleet

Load this when running Phase 4 (Adversarial Review) or a Phase 7 convergence round: which thirteen perspectives to run, how to route them through `agent-teams`, what each agent receives and must return, and how to vary a later round's entry points. The finding record shape (frontmatter `perspective, severity, step, location` + body) is defined in `references/format.md` § `findings/F-nnn.md`; `assets/cp-*.sh` files findings and generates the audit matrix — this reference does not restate their internals.

## The thirteen mandatory perspectives

Every critical plan must be audited from all thirteen. Perspectives that genuinely do not apply (for example accessibility on a backend-only change) are marked `N/A` **with a written reason** in `log/convergence.md` § Perspective Audit Matrix — never silently dropped.

| # | Perspective | Owns | Sample finding it must catch |
|---|-------------|------|------------------------------|
| 1 | **Architecture** | Boundaries, coupling, ownership, module graph, cycles | A domain importing another domain's service by path, creating a cycle at boot |
| 2 | **Implementation** | Files, ordering, dependencies, dead code, duplication | A second implementation of a service that already exists in `common/` |
| 3 | **Frontend↔Backend contracts** | Request/response shape, field presence, types, optionality | The backend stops returning a field a component reads without a guard |
| 4 | **Database contracts & integrity** | Models, columns, scoping, migrations, invariants, orphans | A query that drops the tenant filter inside a `$transaction` |
| 5 | **Error handling & codes** | Every failure path, standardized codes, HTTP statuses | A `throw new Error()` that reaches the client as a raw 500 |
| 6 | **Security & authorization** | Permissions, tenant isolation, IDOR, secret handling | A `where: { id }` lookup reachable across tenants |
| 7 | **Data validation** | DTOs, bounds, nulls, types, coercion, whitelisting | A `number` field accepting a string that becomes `NaN` downstream |
| 8 | **Data load & performance** | Volume, N+1, indexes, pagination, connection pool | A loop issuing one query per row inside a transaction |
| 9 | **Development strategy** | Sequencing, reversibility, feature flags, deploy order | A migration that must land before the code but is scheduled after |
| 10 | **UI/UX & reachability** | Where the function lives, how many clicks, discoverability | A new function reachable only by typing the URL |
| 11 | **Accessibility** | Keyboard, focus, contrast, labels, screen readers | An icon-only action button with no accessible name |
| 12 | **User comprehension** | Copy, empty states, loading states, error messages, help | An error that says "Error 422" instead of what to fix |
| 13 | **Observability & traceability** | Logs, correlation ids, audit trail, silent failures | A `catch {}` that swallows the only evidence a step ran |

## Orchestration rules

- Route through `agent-teams`. Maximum **4 concurrent** agents; run the thirteen perspectives in **waves**. The cap is on concurrency, not on coverage — all thirteen must run.
- **Each perspective agent receives ONLY** the output of `cp-context.sh <bundle> perspective <n> <step-ids…>` (hub excerpt + domain registry + the named steps + the audit matrix), plus the concrete file list from Phase 1 for those steps — **never the whole bundle**.
- The instruction is always the same: attempt to *break* the design from this one perspective, not to validate it.
- Each agent returns a **findings list**, never a narrative. Each finding carries: perspective, severity (`blocker` / `major` / `minor` / `note`), the concrete location, the failure scenario (inputs → wrong outcome), and a proposed fix.
- Findings are filed with `cp-new.sh finding <bundle> "<title>" --sev <s> --persp <n> --round <r> --step <id> --loc "<path:line>"`, then referenced by exactly one checklist line in the owning step. A finding that belongs to no existing step creates a new step first.
- The orchestrator merges findings and deduplicates against **all** of `findings/` (every status, not just open) before filing new ones.
- **Never let a perspective agent write code.** They investigate and report. Fixes are executed as plan steps, under `how-to-dev`, so they inherit the same twelve fields and the same verification.

## Severity definitions

| Severity | Meaning | Effect on the loop |
|----------|---------|--------------------|
| `blocker` | Produces wrong data, data loss, a security hole, or an unrecoverable state | Round is not clean. Must be fixed. |
| `major` | Breaks a contract, produces a raw 500, or degrades a critical path | Round is not clean. Must be fixed. |
| `minor` | Works but is fragile, duplicated, or unclear | Round can be clean. Fix or record a decision. |
| `note` | Observation for future work | Does not affect the loop. Goes to `Knowledge Gaps`. |

## Adversarial prompt template

Use this shape for every perspective agent, every round:

```
GOAL (one sentence): Try to break this design from the <Perspective N — name> perspective. Only this
perspective — the other twelve are covered by sibling agents; do not report outside your lane.

CONTEXT: <paste verbatim the stdout of `cp-context.sh <bundle> perspective <n> <step-ids…>`>

INSTRUCTION: Attempt to break the design, not validate it. Read the named steps and the file list, then
construct concrete attack scenarios: bad input, race condition, tenant crossover, missing guard,
unhandled branch — whatever this perspective owns.

REQUIRED OUTPUT — a list of findings, each with:
- perspective: <n>
- severity: blocker | major | minor | note
- step: <owning step id, or none if it needs a new one>
- location: "<path:line>"
- title: <one line>
- scenario: <inputs → wrong outcome, concrete, not hypothetical>
- proposed fix: <one paragraph>

If you find nothing, show the attack narratives you tried and why each one held. "No issues found" with
no attack narrative means this perspective did not run — it will be re-run.
```

**The explicit rule: "no issues found" without an attack narrative means the perspective did not run.**

## Second-round entry-point variation

The second (and every later) round must vary how each perspective enters the bundle, or it re-asks the same questions and re-finds nothing new for the wrong reason. Vary via `cp-context.sh` inputs:

- **Different step subset** — round 1 perspective 4 audits `A.1 A.2 A.3`; round 2 audits `B.1 B.4 C.2` instead.
- **Different registry first** — round 1 perspective 3 reads `registry/fb.md` before the steps; round 2 reads the steps first, registry last.
- **Call direction reversed** — round 1 walks frontend consumer → backend route; round 2 walks backend route → frontend consumer (or, for perspective 4, migration → model → query instead of query → model → migration).

Record which variation each round used in `log/convergence.md` § Convergence Loop Log — see `references/convergence.md`.
