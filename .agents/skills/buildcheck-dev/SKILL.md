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

## Production Build Rule

Run `npm run build` only when the human explicitly requests one of these:

| Explicit Request | Allowed Command |
| --- | --- |
| Backend production build | `npm run build --workspace apps/backend` or the repo-approved backend build command |
| Frontend production build | `npm run build --workspace apps/frontend` or the repo-approved frontend build command |
| Deployment/production compilation check | The repo-approved production build command for the requested target |

If the human does not explicitly request production verification, do not run production build commands. Development logs are the required verification source.

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
- [ ] Production build was not run unless explicitly requested.
- [ ] If Docker was unavailable, the blocker was reported instead of claiming full verification.

## Golden Rule

Development means Docker logs/watch mode. Production build means `npm run build`, and only when explicitly requested by the human.

## Related Skills

- `vendix-development-rules` - General development rules
- `vendix-naming-conventions` - Naming conventions
- `vendix-backend-domain` - Backend verification patterns
- `vendix-frontend-component` - Frontend verification patterns
