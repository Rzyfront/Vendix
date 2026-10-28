# Release review: commands, reviewer brief, report template

## Inventory commands

```bash
N=<pr>; gh pr view $N --json baseRefName,headRefName,headRefOid,mergeable,body
git fetch origin
git log --first-parent --format='%h %s' origin/main..origin/develop        # stack
git diff --stat origin/main...origin/develop | tail -1                      # size
git diff --name-only origin/main...origin/develop -- apps/backend/prisma/migrations | grep migration.sql
git diff origin/main...origin/develop -- '**/package.json' '**/package-lock.json' | head
git diff --name-only origin/main...origin/develop -- .github Dockerfile* '**/Dockerfile*' '**/*.env*'
gh pr list --base develop --state merged --search "merged:>=<last-release-date>" --json number,title,mergedAt
```

Last release date: `gh pr list --base main --state merged --limit 1 --json mergedAt,number`.

## Migration checks (D1)

```bash
for f in $(git diff --name-only origin/main...origin/develop -- apps/backend/prisma/migrations | grep migration.sql); do
  git show origin/develop:$f | grep -inE "^\s*(DROP|DELETE|TRUNCATE|UPDATE )|CASCADE|ADD VALUE|CONCURRENTLY|NOT NULL" \
    | sed "s#^#$(basename $(dirname $f)): #"
done
```

- `NOT NULL` without default on an existing table → fails on prod rows.
- `ADD VALUE` + use of the value in the same migration → fails inside a transaction.
- `CREATE INDEX CONCURRENTLY` → check `indisvalid` after deploy.
- Unique index on existing data → can fail on duplicates already in prod; ask for a prod count.
- Last prod migration name vs the oldest new one: an older timestamp still applies, but flags a
  branch that sat long and may conflict with schema prod already has.
- Schema vs migrations drift: every new model/column in `schema.prisma` has a migration.

## Contract checks (D2)

- `rg` the changed endpoint paths / response fields in `apps/mobile` (read-only) and
  `apps/frontend`: removed or renamed fields break shipped mobile builds.
- Changed defaults in settings/`default_templates`: existing stores get the new default on read?
- New required DTO fields on existing endpoints → old clients get 400.

## Reviewer brief (per unit, read-only)

> You review unit <name> of release PR #<N> (head <sha>). Read-only: no edits, commits or stash.
> Files: <list>. Commits: <range>. Read each file at the head (`git show <sha>:<path>`), not the
> hunk. Apply the pr-code-review categories (regression x3, security, logic, syntax, core files,
> scope, quality) and its Evidence Gate: every finding cites file:line at the head and the command
> or read that proves it; unverifiable → open question. Mark each finding caused-by-release or
> pre-existing (`git show origin/main:<path>`). Also report: public contracts this unit changes,
> migrations it depends on, permissions/seeds/env it needs. Return ≤ 1.5k tokens, Spanish.

## Report template

```
# Release #<N> — <head sha> — GO | NO-GO

CI (head): <job: result>…
Units: | Unit | Commits | Files | Migrations | Reviewed by PR? |

## P0 (blocks deploy)
- [unit] file:line — defect. Evidence: … Fix: …
## P1 (hotfix)
## P2 (follow-up / pre-existing)

| Dimension | Result | Evidence |
| D1 Migrations | … | … |
… D2–D7

Score: <n>/100 (per unit: …)
Fix plan: odd/tasks/release-<N>-fixes.md
```
