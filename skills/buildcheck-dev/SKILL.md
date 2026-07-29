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

Development verification always uses Docker watch-mode logs. Do **not** run production build commands unless the human explicitly asks for a production build, deployment check, or production compilation check.

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
docker logs --tail 80 vendix_frontend
docker logs --tail 80 vendix_postgres
docker logs --tail 80 vendix_redis
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
| Frontend | `docker logs --tail 40 vendix_frontend` |
| Database/Prisma | `docker logs --tail 40 vendix_postgres` |
| Redis/queues/cache | `docker logs --tail 40 vendix_redis` |
| Nginx/domain routing | `docker logs --tail 40 vendix_nginx` |
| Multiple areas | Check each affected container |
| Container status | `docker ps` |

Expected healthy signals include messages such as `Compiled successfully`, `Successfully compiled`, `Nest application successfully started`, `/api/health` returning `status: ok`, or `database system is ready to accept connections`.

Blocking signals include `ERROR`, `ERROR in`, `TypeError`, `ReferenceError`, TypeScript errors, Angular template parsing errors, missing dependency errors, Prisma generation errors, database syntax errors, Redis connection failures, or repeated container restarts.

## Compilation Check Without Starting Servers (REQUIRED)

> **HARD RULE:** The dev machine has limited memory. Any command that starts a
> server, a watcher, or the Angular prerender worker pool is **forbidden** for
> verification, because an aborted run leaves orphan Node processes holding
> gigabytes of RAM.

When a compilation check is needed — because the change touches types, imports,
templates, or DTOs — use the guarded one-shot runner. It compiles, reports
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

## Memory Budget — 16 GB Dev Machine, 10 Cores

The host does **not** have 16 GB available for a build. The Docker dev stack holds
~8 GB inside the `limactl`/Colima VM (`docker-compose.yml` alone grants
`mem_limit: 6g` to `vendix_frontend`), and that RAM is not released while the
containers exist. Real host budget with the stack up: **~6 GB**.

Consequences that are not negotiable:

| Rule | Reason |
| --- | --- |
| Jest is capped in `apps/backend/package.json`: `maxWorkers: 2`, `workerIdleMemoryLimit: "1024MB"` | Uncapped Jest uses `cores - 1` = **9 workers**, and each `ts-jest` worker builds its own full TypeScript program (~2.5 GB on this repo) → ~24 GB demanded, 12 GB of swap, machine unusable. Config lives in `package.json` so even a bare `npx jest` inherits it. Never raise these on the dev machine. |
| Never run two heavy Node steps at once | Two 3 GB processes plus the Docker VM exceeds physical RAM and drops the machine into swap, where a 15s typecheck takes minutes. |
| `NG_BUILD_MAX_WORKERS=2` for the deep bundle | Angular's bundler opens a worker pool sized by core count. |
| If the preflight aborts, free RAM first | `docker compose stop frontend` releases the heaviest container; `docker compose stop` releases the whole stack. |
| After any killed run, sweep | `npm run buildcheck:reap`. Jest workers in particular survive their parent. |

When the machine bogs down, `npm run buildcheck:top` names the culprit with its
full command line — consecutive PIDs with identical RSS mean a worker pool, and
a pool of `cores - 1` is Jest's default, not Angular's (Angular caps lower).

### Forbidden verification commands

| Never run to verify | Why | Use instead |
| --- | --- | --- |
| `npm run dev`, `npm start` | starts backend + frontend on the host, colliding with Docker | `docker logs` |
| `nest start`, `npm run start:dev -w apps/backend` | boots Nest on :3000 in watch mode, stays alive | `npm run buildcheck:be` |
| `ng serve`, `npm start -w apps/frontend` | dev server stays alive on :4200 | `docker logs vendix_frontend` |
| `ng build --watch` | watcher never exits | `npm run buildcheck:fe` |
| `npm run build:prod -w apps/frontend`, root `npm run build` | production config carries `server: src/main.server.ts` + `prerender`, which bootstraps the SSR app in a worker pool — the main orphan source and the heaviest step | `npm run buildcheck:deep` |
| `npm test -w apps/backend` to verify one new spec | it does not know what you wrote — it runs **all 171 specs** with a worker pool, holding ~1 GB per worker, and the workers outlive a killed parent | `npm run buildcheck:test -- <path/to/that.spec.ts>` |
| `npm run test:debug -w apps/backend` | runs `node --inspect-brk`, which halts before the first line and waits **forever** for a debugger to attach — a permanent orphan, not a slow one | `npm run buildcheck:test` |
| `npm run test:watch -w apps/backend`, `ng test` | watchers never exit; `ng test` also launches a Karma browser | `npm run buildcheck:test` |

Root `npm run build` and `build:prod` stay reserved for a deploy/release build the
human explicitly asks for, ideally in CI rather than on the dev machine.

Development logs remain the primary verification source; `buildcheck` is the
compile gate, not a replacement for checking container logs.

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
- [ ] Compilation checks used `npm run buildcheck*` — never a serve/watch/prerender command.
- [ ] No orphan Node process survived the check (`npm run buildcheck:reap` reports none).
- [ ] Production build (`npm run build`, `build:prod`) was not run unless explicitly requested.
- [ ] If Docker was unavailable, the blocker was reported instead of claiming full verification.

## Golden Rule

Development means Docker logs/watch mode. A compile gate means `npm run buildcheck`
— one shot, no server, no orphans. A production build means `npm run build`, and
only when the human explicitly asks for it.

## Related Skills

- `vendix-development-rules` - General development rules
- `vendix-naming-conventions` - Naming conventions
- `vendix-backend-domain` - Backend verification patterns
- `vendix-frontend-component` - Frontend verification patterns
