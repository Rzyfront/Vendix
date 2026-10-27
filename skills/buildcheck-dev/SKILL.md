---
name: buildcheck-dev
description: >
  Vendix dev verification: watch logs (docker logs, buildcheck.sh --watch), scoped backend test runner, no local builds or typechecks, RAM guards.
  Trigger: verifying a change, checking dev app status, running a backend spec, or a build request.
license: MIT
metadata:
  author: rzyfront
  version: "1.2"
  scope: [root]
---

# Buildcheck Dev

Test scope and forbidden test commands are in `AGENTS.md`. This skill adds how to read dev state and
when a build is allowed.

**A task is not complete while affected surfaces show compile, runtime, type, dependency or template
errors.** Shared frontend component errors → read `apps/frontend/src/app/shared/components/<c>/README.md` first.

## Where verification output lives

| Surface | Runs | Read it with |
| --- | --- | --- |
| Frontend | native `ng serve` (`npm run dev:fe`, :4200) | `bash scripts/buildcheck.sh --watch` → expect `último ciclo  OK` |
| Backend | Docker `vendix_backend` | `docker logs --tail 40 vendix_backend` |
| Postgres / Redis / Nginx | `vendix_postgres` / `vendix_redis` / `vendix_nginx` | `docker logs --tail 40 <name>` |

`--watch` compiles nothing: it reports whether `ng serve` is alive, the verdict and errors of the LAST
cycle (`.dev/frontend-watch.log`, rewritten each cycle by `scripts/dev-fe.sh`). Distrust two answers:
- `RANCIO` — log exists but nothing listens on :4200; the verdict is history.
- `SIN DATOS` — `ng serve` was started by hand; ask to restart with `npm run dev:fe`.

There is no `vendix_frontend` container (only the optional `docker-fe` profile). Never tell the human
to "read the dev:fe terminal" — agents cannot see it.

## Dev app status ("how is dev?")

1. `docker compose ps` (or `docker ps --filter name=vendix_`).
2. `docker logs --tail 80` of `vendix_backend`, `vendix_postgres`, `vendix_redis` (+ `vendix_nginx` if routing is involved).
3. `bash scripts/buildcheck.sh --watch`.
4. HTTP: `curl -fsS http://localhost:3000/api/health` and `curl -sk -o /dev/null -w "%{http_code}\n" https://vendix.com/` (vhost, never `localhost:4200`: it has no `domain_settings` row).
5. Summarize per service: running/stopped, recent errors, HTTP result, next fix. A 200 is not enough if logs show errors.

Blocking signals: `ERROR`, `TypeError`, `ReferenceError`, TS/template errors, missing deps, Prisma
generation errors, DB syntax errors, Redis connection failures, restart loops.

## Builds and typechecks: never automatic

Never run `tsc`, `ngc`, `ng build`, `npm run build*` or `npm run buildcheck` / `:be` / `:fe` / `:deep`
in development or as a self-initiated pre-PR gate (CI `ci.yml` covers it). Only two exceptions:
1. The human explicitly asks to test a build.
2. Release prep: **suggest** it, mention CI already gates it, and wait for confirmation.

Even then, never start a server, watcher or prerender. Use the guarded runner and sweep orphans with
`npm run buildcheck:reap`. Commands, private-log invocation, report fields and memory budget:
`references/buildcheck-runner.md` (leer bajo demanda).

Also never run to verify: `npm run dev` / `npm start` (starts the backend on the host too, colliding
with the container), `nest start` / `start:dev -w apps/backend`, a second `ng serve`, `ng build --watch`,
`docker compose --profile docker-fe up frontend` while the native one runs.

## Docker unavailable or stopped

Report the blocker and do not claim full verification. Do not start/restart/rebuild containers unless
the task needs it or the human approves; restart a stopped container only if it clearly belongs to the
affected service (`docker ps -a`). Restart/recreate (`docker compose restart <svc>`, `build --no-cache`,
`up -d --force-recreate`) only for cache, dependency, Dockerfile, compose or stuck-container issues;
then re-check logs and `docker ps`.

## Related Skills

- `how-to-test` — runtime verification (curl, Playwright MCP)
- `vendix-known-errors` — misleading green results
