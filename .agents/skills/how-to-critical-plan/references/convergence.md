# The Convergence Loop

Load this when running Phase 7 after execution: how each round audits the current state, how findings are filed and deduplicated, the exit condition, and how to close a finding (`fixed` / `accepted` / `rejected`). Table shapes below match `references/format.md` § Logs (`log/convergence.md`); the perspective fleet that runs each round is defined in `references/perspectives.md`. `cp-ledger.sh` / `cp-lint.sh` implement the generation and gating — this reference does not restate their internals.

## The loop

```
round = 1
repeat:
  run the thirteen perspectives (references/perspectives.md) against the CURRENT state
    (bundle + code + live behavior), each blind to the others' findings this round
  file each finding: `cp-new.sh finding <bundle> "<title>" --sev <s> --persp <n> --round <r> --step <id> --loc "<path:line>"`
  add exactly one checklist line in the owning step for each filed finding
  deduplicate against ALL of `findings/` (every status — open, fixed, accepted, rejected), not just open ones
  fix every blocker and major as a plan step under `how-to-dev`, inheriting the twelve step fields
  run `cp-lint.sh <bundle>` — must pass before the round is recorded
  record the round as one row in `log/convergence.md` § Convergence Loop Log, with the round's F-nnn ids
    in the `Findings` column
  run `cp-ledger.sh <bundle>`
  round += 1
until two CONSECUTIVE rounds produce zero new blocker and zero new major findings
```

## Rules

- **Two consecutive clean rounds, not one.** One clean round is as likely to mean the agents asked the same questions again as it is to mean the work is sound. The second round must vary its entry points — see `references/perspectives.md` § Second-round entry-point variation.
- **Deduplicate against recorded findings, not against fixed ones.** Deduplicating against the fixed list makes rejected-but-real findings reappear forever and the loop never converges.
- **A finding is never closed by re-rating it.** It is closed by a fix, or by a `- [-]` with a named human authorizer and a written reason. Anyone may audit those decisions later; that is the point.
- **The loop has a floor, not a ceiling.** Minimum two rounds even if the first is clean. If the loop passes six rounds without converging, stop and escalate to the human: the design, not the code, is probably wrong.

## Perspective Audit Matrix (`log/convergence.md`)

```markdown
## Perspective Audit Matrix
| # | Perspective | Round run | Findings (B/M/m/N) | Status |
|---|-------------|-----------|--------------------|--------|
| 1 | Architecture | — | 0/0/0/0 | pending |
```

13 rows, one per perspective (see `references/perspectives.md`). An `N/A` `Status` requires a written reason — `cp-lint.sh` rule L25 only checks that the 13 rows exist, not that the reason text is meaningful; the reason itself is a human-judgment check, see `references/validation-checklist.md`.

## Convergence Loop Log (`log/convergence.md`)

Columns:

```markdown
## Convergence Loop Log
| Round | Date | Blockers | Majors | Minors | New steps filed | Findings | Outcome |
|-------|------|----------|--------|--------|-----------------|----------|---------|
| 1 | 2026-08-18 | 3 | 7 | 12 | B.7, C.4 | F-001..F-022 | Not clean |
| 2 | 2026-08-19 | 0 | 2 | 5 | C.5 | F-023..F-029 | Not clean |
| 3 | 2026-08-20 | 0 | 0 | 2 | — | F-030, F-031 | Clean (1/2) |
| 4 | 2026-08-21 | 0 | 0 | 1 | — | F-032 | Clean (2/2) — loop closed |
```

Rows ≤ 300 chars — list a range (`F-001..F-022`) rather than every id when a round files many; the per-finding detail lives in `findings/`, never in this row.

## Closing a finding

| Outcome | Requirement |
|---|---|
| `fixed` | Evidence path recorded in the finding's `Resolution`; the owning step's checklist line flips to `[x] F-nnn — <title> (<sev>) → evidence/…`. |
| `accepted` | Requires `accepted_by` = a named human in the finding's frontmatter; the step's checklist line becomes `[-] F-nnn — <title> (<sev>)` with a `Descartado:` reason. |
| `rejected` | Refuted with evidence in the finding's `Resolution`; the finding stays in `findings/` (never deleted) so future dedup still sees it. |
