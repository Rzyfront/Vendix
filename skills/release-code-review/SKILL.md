---
name: release-code-review
description: >
  Deep review of a develop→main release as a STACK of changes: inventory, per-unit review on the final state, cross-unit interactions, migrations and deploy order, backwards compatibility, rollback, versioning. Produces a go/no-go and a fix plan.
  Trigger: reviewing a release PR (develop→main), "release check", pre/post-deploy audit of a release.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
---

# Release Code Review

A release is not one change: it is a stack of units (features, fixes, migrations) landing in
production together, on data and clients that already exist. Review what the **stack** does to
production, not what each commit did to its parent.

Builds on `pr-code-review`: its **Evidence Gate**, categories and message rules apply unchanged
(read that skill first). Commands, delegation prompts and report template:
`references/release-dimensions.md` (leer bajo demanda).

## Flow

1. **Identify the release.** `gh pr view N --json baseRefName,headRefName,headRefOid,mergeable,state`.
   Base must be `main`, head `develop`. Record the head SHA: every finding cites it. `mergeable:false`
   → stop, conflict template, 0/100.
2. **CI of the exact head.** `gh pr checks N` mixes push and PR runs: separate them by
   `gh run view <id> --json event,headSha` and judge only runs of the head SHA. A red required check
   is a **P0** (deploy is blocked) — read its failing log before anything else.
3. **Inventory the stack** (`git log --first-parent origin/main..develop`, merged PRs since the
   last release, direct pushes to `develop` without PR = unreviewed units, higher risk). Group commits
   into **units** by domain/feature. Per unit list: commits, files, migrations, new deps/env/config,
   new jobs/crons/queues, new permissions/seeds, public contracts touched.
4. **Per-unit review on the FINAL state.** Each unit gets the `pr-code-review` categories, but read
   the files at the release head, not intermediate commits: a later commit may fix, revert or
   re-break an earlier one. Units reviewed before by `pr-code-review` get a lighter pass focused on
   what changed after their review.
5. **Stack interactions** (the part a PR review cannot see):
   - Same file / same function touched by 2+ units → read the merged result; the last writer may
     have dropped the other's behavior.
   - Shared helper, DTO, event payload, enum or error catalog changed by one unit and consumed by
     another (or by untouched code) → `rg` every consumer at the head.
   - Aggregate effects: a catalog/union/schema growing past a tool limit (TS2590, bundle budget,
     Prisma client size), cumulative N+1s on one hot path, two listeners on one event.
6. **Release dimensions** (all mandatory, each with evidence or "N/A because …"):
   | # | Dimension | Question |
   | --- | --- | --- |
   | D1 | Migrations & deploy order | Do all migrations apply on **prod data** (not an empty DB), idempotent, no data loss (`vendix-prisma-migrations` Rule 7), timestamps after prod's last applied, enum `ADD VALUE` not used in the same transaction, `CONCURRENTLY` checked? Does the code deploy before/after the schema safely? |
   | D2 | Backwards compatibility | Existing stores/tenants, existing rows (nulls in new columns), changed defaults/settings, API contracts consumed by **apps/mobile** and by stale cached frontends during the deploy window, event/queue payloads in flight. |
   | D3 | Build & runtime | Prod build (CI), new env vars, new deps, assets copied into the image (`dist`), backend vs worker module registration, new crons/queues and their scheduling in prod. |
   | D4 | Permissions & seeds | New permissions/roles synced to prod (prod seed / `syncRolePermissions`), menu/panel_ui visibility, industry gating. |
   | D5 | Money, fiscal, tenancy | Any unit touching DIAN, accounting, payments, AR, stock or tenant scoping gets a full high-risk read regardless of size. |
   | D6 | Rollback | If the deploy is reverted with migrations applied, does the old code still run? Irreversible effects (emitted invoices, sent emails, charged cards) listed. |
   | D7 | Versioning & release notes | Title/body describe every unit with its user story, migration block present, CHANGELOG/version/tag per repo convention, Linear RULE 10 (`git-workflow`). |
7. **Verify, then classify.** Evidence Gate on every finding. Severity for a release:
   - **P0 — blocks deploy:** red required CI, migration that fails or loses data, prod crash path,
     security hole, money/fiscal corruption.
   - **P1 — fix before or right after deploy (hotfix):** verified regression of an existing flow,
     broken contract for mobile/old clients, missing permission/seed making a feature unusable.
   - **P2 — follow-up:** quality, debt, advisories, pre-existing issues the release did not cause
     (tag them "pre-existing", never as regressions).
8. **Verdict.** GO only with zero P0. Score the release with the `pr-code-review` weights over
   verified findings; report per unit and the stack total.
9. **Fix plan** (when asked or when P0/P1 exist): one ODD feature doc
   `odd/tasks/release-<pr>-fixes.md` — specs per finding with its evidence and the observable
   acceptance criterion, tasks ordered P0 → P1 → P2, route and verification per task. Present it
   for approval; implement only on "ejecuta".

## Delegation (large releases)

Release diff > ~3000 lines → one read-only reviewer per unit (or group of small units), launched in
parallel, each given: release head SHA, its commit range and file list, the `pr-code-review`
categories, the Evidence Gate, and the instruction to read files at the head. The parent owns steps
1–3, 5, 6 and 8. Every P0/P1 a reviewer reports is re-verified by the parent (or an Opus verifier)
before it reaches the report — reviewers' confident claims are hypotheses until checked. Heavy
commands follow AGENTS.md: one spec per jest run, never tsc/ngc/karma/full suites locally.

## Output

Report: release head SHA, CI state, unit inventory table, findings by severity (file:line at head,
evidence, unit, pre-existing or caused), D1–D7 table, score, GO / NO-GO, and the fix plan link.
Post to the PR only when asked. No AI signature anywhere.
