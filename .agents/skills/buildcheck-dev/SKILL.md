---
name: buildcheck-dev
description: >
  Build and runtime verification steps for Vendix development.
  Trigger: Verifying Build, checking Docker watch-mode logs, checking current development app status, or confirming development changes do not introduce compile/runtime errors.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Verifying Build"
    - "Checking Docker development logs after code changes"
    - "Checking current development app status"
    - "Verifying that code compiles without starting any server"
    - "Running a production compilation check without leaving orphan processes"
    - "Killing orphan ng serve, ng build, prerender or nest start processes"
    - "Running backend jest tests without exhausting dev machine memory"
    - "Diagnosing which node process is consuming the dev machine memory"
---

# Buildcheck Dev

> **CRITICAL:** A task is not complete while affected development containers show compilation, runtime, type, dependency, or template errors.

> **Shared component tip:** If frontend logs show errors in shared components, check `apps/frontend/src/app/shared/components/{component}/README.md` before changing the component usage.

## Core Rule

Development verification always uses **watch-mode output** — nothing else. Since 2026-08-30 that
output comes from two places, because the frontend no longer runs in Docker:

| Surface | Where it runs | Where you read it |
| --- | --- | --- |
| Frontend | **native `ng serve` on macOS** (`npm run dev:fe`) | the terminal running it |
| Backend, Postgres, Redis, Nginx | Docker | `docker logs` |

Never run `tsc`, `ngc`, `ng build`, `npm run build`, `npm run build:prod`, or any
`npm run buildcheck*` command as part of normal development, and never as an automatic
pre-PR/pre-push gate. These commands hold multiple gigabytes of RAM on a machine that is already
budgeted for the dev stack (see Memory Budget below) and freeze it.

The native `ng serve` is **not** an exception to that rule: it is a long-lived watcher you start
once and leave running, not a one-shot build you fire to check something.

GitHub Actions (`.github/workflows/ci.yml`) already runs the build before merge/release, so a local
build adds little and costs a lot. The **only** two legitimate reasons to run a build/typecheck
command locally are:

1. The human explicitly asks, verbally, to test a build (any wording — "prueba el build", "corre un
   build", "test the production build").
2. The human is preparing a release. Even then, **suggest** running `buildcheck`/`build:prod` and
   wait for confirmation — do not run it unprompted. Mention that CI already gates it, so it is
   optional insurance, not a requirement.

Outside those two cases, a task is verified and complete using Docker logs alone.

## Current Dev App Status Workflow

Use this workflow when the human asks how the development app is doing, whether the dev environment is healthy, or to "check app dev" before or after changes.

1. Check compose service state first:

```bash
docker compose ps
docker ps --filter "name=vendix_" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

2. Check short logs for the core development services:

```bash
docker logs --tail 80 vendix_backend
docker logs --tail 80 vendix_postgres
docker logs --tail 80 vendix_redis
```

There is no `vendix_frontend` container any more. For the frontend, read the terminal where
`npm run dev:fe` is running — the healthy signal is `Application bundle generation complete`.
To confirm it is up at all without touching its terminal:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4200/
```

3. Run lightweight HTTP checks only after containers are running:

```bash
curl -fsS http://localhost:3000/api/health
curl -I -fsS http://localhost:4200
```

4. If `vendix_nginx` is part of the reported problem, also inspect:

```bash
docker logs --tail 80 vendix_nginx
```

5. Summarize status by service: running/stopped, recent errors, HTTP health result, and next required fix.

Do not treat a healthy HTTP response as enough if watch-mode logs still show TypeScript, Angular template, NestJS runtime, dependency, Prisma, Redis, or database errors.

## Default Verification Workflow

1. Apply the code change.
2. Check the logs for every affected development container using `docker logs --tail 40`.
3. Check container status with `docker ps`.
4. If logs contain errors, fix them and repeat from step 2.
5. Finish only when affected containers are running and logs show zero relevant errors.

## Development Commands

Use the commands that match the files changed:

| Change Area | Required Check |
| --- | --- |
| Backend | `docker logs --tail 40 vendix_backend` |
| Frontend | terminal of `npm run dev:fe` → `Application bundle generation complete` |
| Database/Prisma | `docker logs --tail 40 vendix_postgres` |
| Redis/queues/cache | `docker logs --tail 40 vendix_redis` |
| Nginx/domain routing | `docker logs --tail 40 vendix_nginx` |
| Multiple areas | Check each affected container |
| Container status | `docker ps` |

Expected healthy signals include messages such as `Compiled successfully`, `Successfully compiled`, `Nest application successfully started`, `/api/health` returning `status: ok`, or `database system is ready to accept connections`.

Blocking signals include `ERROR`, `ERROR in`, `TypeError`, `ReferenceError`, TypeScript errors, Angular template parsing errors, missing dependency errors, Prisma generation errors, database syntax errors, Redis connection failures, or repeated container restarts.

## Compilation/Build Checks — Never Automatic, Suggest-Only

> **HARD RULE:** Do not run any command below during normal development or as a self-initiated
> pre-PR/pre-push gate. Docker logs are the only required verification. These commands exist for the
> two exceptions in the Core Rule (explicit human request, or release prep after the human confirms
> the suggestion) and, even then, any command that starts a server, a watcher, or the Angular
> prerender worker pool stays **forbidden**, because an aborted run leaves orphan Node processes
> holding gigabytes of RAM.

When one of the two exceptions applies, use the guarded one-shot runner. It compiles, reports
PASS/FAIL, and kills its whole process group on exit:

| Need | Command | What it runs |
| --- | --- | --- |
| Both apps | `npm run buildcheck` | backend `tsc --noEmit` + frontend `ngc` typecheck |
| Backend only | `npm run buildcheck:be` | `tsc -p apps/backend/tsconfig.build.json --noEmit` |
| Frontend only | `npm run buildcheck:fe` | `ngc -p apps/frontend/tsconfig.buildcheck.json` (AOT + `strictTemplates`, no bundle) |
| **One spec you just wrote** | `npm run buildcheck:test -- src/domains/.../x.spec.ts` | that spec only, `--runInBand` (single process, no pool) — ~5s |
| Whole backend suite | `npm run buildcheck:test` | all 171 specs, `--maxWorkers=2 --workerIdleMemoryLimit=1024MB --ci --forceExit` |
| Full bundle (pre-PR / release) | `npm run buildcheck:deep` | `ng build --configuration buildcheck` — real bundle, **no prerender, no SSR** |
| Sweep leftovers from a killed run | `npm run buildcheck:reap` | TERMs orphan `ng serve` / `ng build` / prerender / `nest start` / `jest-worker` processes |
| Diagnose a memory spike | `npm run buildcheck:top` | lists every `node` process over 300MB with its command line, plus the Docker VM |

Properties of the runner (`scripts/buildcheck.sh`):

- Never serves, never watches, never prerenders.
- Each step runs in its own process group; the group is TERM/KILLed on exit,
  timeout, or Ctrl-C, so `esbuild` and Angular workers cannot survive.
- Hard timeout (`BUILDCHECK_TIMEOUT`, default 900s) and RAM caps
  (`BUILDCHECK_BE_MEM` 3072MB, `BUILDCHECK_FE_MEM` 4096MB).
- Steps run **sequentially on purpose** — running them in parallel is what exhausts RAM.
- Logs land in `.buildcheck/<step>.log`; failures print the first error lines.
- Backend typecheck is incremental (`dist/tsconfig.build.tsbuildinfo`): first run
  is slow (~85s cold), later runs are seconds. Frontend typecheck ~15s warm.
- A **preflight** aborts before spawning anything if free RAM is below what the
  step needs. Override only knowingly with `--force`.

### Shared log path — do not trust the file under `.buildcheck/`

The runner writes its log to `.buildcheck/<step>.log`, a path that lives **inside the repo and inside the shared dev tree**. When more than one agent is working on the same checkout at once, the file is being written by N writers and read by N readers. A PASS line that this agent reads may belong to a different agent's run, on a different tree state, finished seconds ago or minutes ago. Reporting `buildcheck PASS` without confirming the log was produced by the local run on the final tree is reporting hearsay.

Two specific signals that a reported PASS is not trustworthy:

1. **Total time landing exactly on `BUILDCHECK_TIMEOUT` (default 900 s).** This is not coincidence: it is the pattern of the pipeline hanging on an orphaned `sleep` left behind by a previous run. The typecheck step itself may still have completed and emitted `PASS`, so the verdict can be true, but a total time equal to the timeout is a tell that the wrapper did not exit cleanly and that the `exit code` is suspect.
2. **Identical lines between two consecutive reports.** If the last 10 lines of `.buildcheck/frontend-typecheck.log` look exactly like the previous run's last 10 lines — including timestamps that haven't advanced — the file was probably not overwritten.

Correct invocation when the runner is used at all (still subject to the two exceptions in the Core Rule):

```bash
LOG=/tmp/buildcheck-$$-fe.log            # $$ is this shell's PID: no collision with other agents
date -u +"start %Y-%m-%dT%H:%M:%SZ"
npm run buildcheck:fe > "$LOG" 2>&1; echo "exit=$?"
date -u +"end   %Y-%m-%dT%H:%M:%SZ"
tail -12 "$LOG"
```

Read the `exit code`, not the last line of the log. Capture `$?` on the line right after the command — any other command in between overwrites it.

Always report:

- The **HEAD hash** taken in the same shell call as the report — not a hash copied from a previous minute's dump. `dev` moves under you.
- **UTC start and end** of the local run.
- An explicit confirmation that the tree was the **final** state, not an intermediate one.

For anyone orchestrating pushes: run your own buildcheck, then add a **HEAD guard immediately before pushing** that compares the local `git rev-parse HEAD` against the SHA you audited. A 2-minute typecheck is enough time for another agent to land a commit on `dev`.

## Memory Budget — 16 GB Dev Machine, 10 Cores

The host does **not** have 16 GB available for a build. Two consumers share it:

| Consumer | Budget |
| --- | --- |
| Colima VM (db, redis, backend, nginx) | **6 GiB reserved**, not released while the VM is up |
| Native `ng serve` (`npm run dev:fe`) | ~4-5 GB resident once warm |

Real host budget with the full dev environment up: **~4 GB**. The frontend left Docker on
2026-08-30 precisely because it did not fit: measured with the old layout, `vendix_frontend` held
**5.4 GiB of its 5.5 GiB cgroup (98.2 %)** while the host had **903 MB free**.

Running natively removed the cgroup, so the frontend no longer dies with `CONSTRAINT_MEMCG` — but
it did **not** make it cheap. It is still the heaviest process on the machine, and it now competes
with builds directly rather than from behind a memory limit.

Consequences that are not negotiable:

| Rule | Reason |
| --- | --- |
| Jest is capped in `apps/backend/package.json`: `maxWorkers: 2`, `workerIdleMemoryLimit: "1024MB"` | Uncapped Jest uses `cores - 1` = **9 workers**, and each `ts-jest` worker builds its own full TypeScript program (~2.5 GB on this repo) → ~24 GB demanded, 12 GB of swap, machine unusable. Config lives in `package.json` so even a bare `npx jest` inherits it. Never raise these on the dev machine. |
| Never run two heavy Node steps at once | Two 3 GB processes plus the Docker VM exceeds physical RAM and drops the machine into swap, where a 15s typecheck takes minutes. |
| `NG_BUILD_MAX_WORKERS=2` for the deep bundle | Angular's bundler opens a worker pool sized by core count. |
| If the preflight aborts, free RAM first | `pkill -f 'ng serve'` releases the heaviest process (native, ~4-5 GB); `docker compose stop` releases the VM's share. |
| After any killed run, sweep | `npm run buildcheck:reap`. Jest workers in particular survive their parent. |

When the machine bogs down, `npm run buildcheck:top` names the culprit with its
full command line — consecutive PIDs with identical RSS mean a worker pool, and
a pool of `cores - 1` is Jest's default, not Angular's (Angular caps lower).

### Forbidden verification commands

| Never run to verify | Why | Use instead |
| --- | --- | --- |
| `npm run dev`, `npm start` | starts **backend** on the host too, colliding with the container | `npm run dev:fe` for the frontend, `docker logs vendix_backend` for the backend |
| `nest start`, `npm run start:dev -w apps/backend` | boots Nest on :3000 in watch mode, stays alive | `docker logs vendix_backend` |
| A **second** `ng serve` | the dev server is already running natively on :4200; a second one either fails to bind or fights the first for the port | read the terminal of the `npm run dev:fe` that is already up |
| `docker compose --profile docker-fe up -d frontend` while the native one runs | both publish 4200 | pick one; the native path is the default |
| `ng build --watch` | watcher never exits, and it is not how this repo serves the frontend | `npm run dev:fe` |
| `npm run build:prod -w apps/frontend`, root `npm run build`, any `npm run buildcheck*` | not a dev-verification step at all — see Core Rule; runs only on explicit request or confirmed release prep | `docker logs` (dev) / CI already covers the rest |
| `npm test -w apps/backend` to verify one new spec | it does not know what you wrote — it runs **all 171 specs** with a worker pool, holding ~1 GB per worker, and the workers outlive a killed parent | `npm run buildcheck:test -- <path/to/that.spec.ts>` (test execution, not a build — still scoped to avoid the worker-pool blowup) |
| `npm run test:debug -w apps/backend` | runs `node --inspect-brk`, which halts before the first line and waits **forever** for a debugger to attach — a permanent orphan, not a slow one | `npm run buildcheck:test` |
| `npm run test:watch -w apps/backend`, `ng test` | watchers never exit; `ng test` also launches a Karma browser | `npm run buildcheck:test` |

`npm run build`, `build:prod`, and every `npm run buildcheck*` compile/typecheck command stay
reserved for the two exceptions in the Core Rule — never for routine development, never as a
self-initiated PR gate. GitHub Actions (`ci.yml`) already runs the build before merge/release.

Development logs are the **only** required verification source for development work.

## Docker Availability

If Docker is unavailable, Docker Desktop is stopped, or the expected containers do not exist:

1. Report the verification blocker clearly.
2. Do not mark the task as fully verified.
3. Do not start, restart, rebuild, or recreate containers unless that action is necessary for the task or the human approves it.

If a relevant container exists but is stopped unexpectedly, inspect `docker ps -a` and only restart it when it clearly belongs to the affected Vendix service.

## Container Restart/Recreate

Use restart or recreate only for cache, dependency, Dockerfile, compose, or stuck-container issues.

Prefer the compose command used by the repository (`docker compose` or `docker-compose`). Examples below use `docker compose`.

```bash
# Restart a service
docker compose restart <service>

# Rebuild one service after dependency or Dockerfile changes
docker compose build --no-cache <service>
docker compose up -d <service>

# Recreate one service safely
docker compose stop <service>
docker compose rm -f <service>
docker compose up -d <service>

# Force recreate all services only when needed
docker compose up -d --force-recreate
```

After any restart or recreate, re-run the development log checks and `docker ps`.

## Completion Checklist

- [ ] Logs checked for all affected development containers with `docker logs --tail 40`.
- [ ] Container status checked with `docker ps`.
- [ ] Dev app status requests include `docker compose ps` and lightweight HTTP checks when containers are running.
- [ ] Zero relevant errors remain in affected logs.
- [ ] Fixes were re-verified after changes.
- [ ] No `tsc`, `ngc`, `ng build`, `npm run build*`, or `npm run buildcheck*` command was run — unless
      the human explicitly asked to test a build, or confirmed a suggested release-prep build.
- [ ] If a build/typecheck command *was* run (one of the two exceptions), no orphan Node process
      survived it (`npm run buildcheck:reap` reports none).
- [ ] If Docker was unavailable, the blocker was reported instead of claiming full verification.

## Golden Rule

Development means watch-mode output — the `npm run dev:fe` terminal for the frontend, `docker
logs` for everything else. Nothing else. Never run a build or compile-check unprompted, not even
before a PR: CI (`ci.yml`) already gates the build before merge/release. A
build or `npm run buildcheck*` runs only when the human explicitly asks, or when preparing a
release and the human confirms your suggestion to run one.

## Related Skills

- `vendix-development-rules` - General development rules
- `vendix-naming-conventions` - Naming conventions
- `vendix-backend-domain` - Backend verification patterns
- `vendix-frontend-component` - Frontend verification patterns
