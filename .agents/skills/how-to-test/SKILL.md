---
name: how-to-test
description: >
  Runtime verification methodology for Vendix: curl for API/auth contracts and agent-browser for
  frontend end-to-end flows, run against the real local vhost (vendix.com).
  Trigger: Verifying an API endpoint or auth boundary with curl, running an end-to-end frontend
  flow, driving a browser to confirm UI behavior, installing or configuring agent-browser, or
  choosing test credentials (seed accounts vs user-provided).
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Verifying an API endpoint or auth boundary with curl"
    - "Running an end-to-end frontend flow in a browser"
    - "Driving a browser to confirm UI behavior with agent-browser"
    - "Installing or configuring agent-browser (CLI or MCP)"
    - "Choosing test credentials from seeds or asking the user"
    - "Reaching the app via the local vhost vendix.com instead of localhost"
allowed-tools: Read, Bash, Glob, Grep
---

# How To Test

## Purpose

Define **how an agent verifies Vendix at runtime** after a change. Two mechanisms, two jobs:

| Mechanism | Verifies | Owns |
| --- | --- | --- |
| `curl` | API contracts, auth boundaries, endpoint shape, status codes | Backend / API |
| `agent-browser` | End-to-end frontend flows the user actually sees (login, navigation, forms, render) | Frontend |

This skill governs **functional/E2E verification**. It does **not** govern build/compile/runtime-log
checks — those belong to `buildcheck-dev`. The two are complementary: `buildcheck-dev` proves the
code *compiles and boots*; `how-to-test` proves it *behaves correctly*.

## Core Rules

- **Step 0 — confirm the local dev server is healthy with `buildcheck-dev` BEFORE running any test.**
  This is the gate every other check depends on. A container showing `Up` is **not** proof it works:
  the Node process can crash on boot while the container stays `Up` (a `MODULE_NOT_FOUND` in
  `auth.service.ts` surfaces as nginx `502`, not a stopped container). Check Docker watch-mode **logs**
  and `curl -fsS http://localhost:3000/api/health`, never just `docker ps`. If the server is unhealthy,
  fix that first — no `curl` or `agent-browser` result is valid against a broken server.
- **`curl` is the primary mechanism for API and auth verification. Never run Bruno (`.bru`) as agent
  verification** — Bruno is an opt-in template (`vendix-bruno-test`) only when a human explicitly asks.
- **`agent-browser` is the mechanism for frontend E2E.** It sees the page as an accessibility tree
  (roles + labels + `@e` refs), not pixels — deterministic, not CSS-selector-fragile. It verifies
  *behavior*, not visual design (design judgment needs a screenshot + a vision model).
- **Always reach the frontend through the real vhost (`https://vendix.com` and its subdomains), not
  `http://localhost:4200`.** The frontend resolves its `app_type` by hostname via
  `GET /api/public/domains/resolve/{hostname}` (`apps/frontend/src/app/core/services/app-config.service.ts`).
  `localhost` has no `domain_settings` row, so the app cannot resolve which app to render and
  bootstraps wrong. The hostname *is* the test fixture.
- **Credentials come from seed accounts or from the user — never invent them.** Default to a seed
  owner account; if the flow needs a specific tenant/role the seeds don't cover, ask the user for
  `slug`, `email`, `password`.
- **Verify, don't assume.** A documented command that fails in dev means the doc is wrong — fix it.
  Build passing ≠ flow working, especially for zoneless/signals UI (see `vendix-zoneless-signals`).

## Local Environment (prerequisite for every test)

The app runs in Docker with an nginx vhost in front. Before any E2E test:

1. **`/etc/hosts`** must map the vhosts to localhost:
   ```
   127.0.0.1 vendix.com www.vendix.com api.vendix.com
   ```
   Add any store/org subdomain you intend to test (the full set lives in
   `apps/backend/prisma/seeds/domains.seed.ts`).
2. **Bring the stack up and confirm it is actually healthy** — this is the Step 0 gate; delegate the
   detail to `buildcheck-dev`:
   ```bash
   docker compose up -d
   docker compose ps                            # every vendix_* container Up
   docker logs --tail 40 vendix_backend         # logs CLEAN — no MODULE_NOT_FOUND / Nest boot crash
   docker logs --tail 40 vendix_frontend        # expect "Compiled successfully"
   curl -fsS http://localhost:3000/api/health   # backend really answering (not just Up)
   ```
   A green `docker ps` is **not** enough: a container stays `Up` while its Node process crashes on
   boot, surfacing as nginx `502`. If `/api/health` fails or logs show errors, **stop and fix the
   server first** — every curl / agent-browser step below is invalid against a broken server.
3. **Containers & ports** (`docker-compose.yml`, `nginx.conf`):

   | Container | Port | Vhost |
   | --- | --- | --- |
   | `vendix_frontend` | 4200 | `vendix.com`, `www.vendix.com` → 443 |
   | `vendix_backend` | 3000 | `api.vendix.com` → 443 |
   | `vendix_postgres` | 5432 | — |
   | `vendix_redis` | 6379 | — |
   | `vendix_nginx` | 80, 443 | TLS proxy (self-signed wildcard `*.vendix.com`) |

4. **SSL:** the cert is a self-signed wildcard. Either trust the CA (`ssl/ca/ca-cert.pem`, see
   `ssl/README-INSTALLATION.md`) or pass curl `-k` / the browser's TLS-ignore option. Verify the exact
   browser flag with `agent-browser open --help` before assuming one.
5. **Frontend → backend wiring:** the frontend calls `https://api.vendix.com/api` (see
   `apps/frontend/src/environments/environment.development.ts`). Global API prefix is `/api`.

> If Docker is down, containers are missing, or the Step 0 health gate above fails, report the
> blocker — do **not** claim a flow was verified. `buildcheck-dev` owns bringing the stack back to health.

## Credentials (seed accounts)

All seed users share password `1125634q`. Source of truth:
`apps/backend/prisma/seeds/users.seed.ts`, `organizations-stores.seed.ts`, `domains.seed.ts`.

| Email | Role | Org slug | Store slug | Typical vhost |
| --- | --- | --- | --- | --- |
| `admin@vendix.online` | super_admin | `vendix` | `tienda-principal` | `vendix.com` (`/super-admin`) |
| `owner@techsolutions.co` | owner | `tech-solutions` | `tech-bogota` | `admin-techsolutions.vendix.com` |
| `owner@fashionretail.com` | owner | `fashion-retail` | `fashion-norte` | `fashionretail.vendix.com` |
| `admin@techsolutions.co` | admin | `tech-solutions` | `tech-bogota` | `admin-techsolutions.vendix.com` |
| `cliente1@example.com` | customer | `tech-solutions` | `tech-bogota` | store ecommerce subdomain |

Need a role/tenant the seeds don't cover → **ask the user** for `slug`, `email`, `password`. Confirm
the exact subdomain per persona in `domains.seed.ts` and add it to `/etc/hosts`.

## Mechanism 1 — curl (API & auth)

Login returns the token inside `data.access_token` (NOT a top-level field; permissions live in
`data.permissions`, never in the JWT — see `vendix-backend-auth`). Staff login needs
`organization_slug` **or** `store_slug` (not both); customer login uses `/api/auth/login-customer`
with a numeric `store_id`.

```bash
# 1. Get a token (vhost-first; -k accepts the self-signed cert)
TOKEN=$(curl -sk -X POST https://api.vendix.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@techsolutions.co","password":"1125634q","organization_slug":"tech-solutions"}' \
  | jq -r '.data.access_token')

# 2. Call a protected endpoint
curl -sk -H "Authorization: Bearer $TOKEN" https://api.vendix.com/api/store/orders | jq '.data | length'

# Auth-boundary check: same call without/with a token lacking the permission must return 403.
```

- **Base URL:** `https://api.vendix.com/api` (vhost) or `http://localhost:3000/api` (no-SSL fallback).
- **`jq`** is available for extraction.
- For full endpoint conventions and pagination shape, see `vendix-backend-api`.

## Mechanism 2 — agent-browser (frontend E2E)

`agent-browser` is a native Rust CLI that drives Chrome via CDP. Workflow: **open → snapshot → act →
assert → close**. Each command is stateless on the CLI but shares one long-lived browser daemon.

### Install / configure if missing

```bash
command -v agent-browser || brew install agent-browser   # or: npm install -g agent-browser
agent-browser install                                     # downloads Chrome for Testing
agent-browser doctor                                      # must report 0 fail
```

Register as an MCP server so the agent gets native browser tools (per-agent config — the binary is
global, the registration is not):

```bash
claude mcp add agent-browser --scope user -- agent-browser mcp   # Claude Code
```

For OpenCode / Codex / MiniMax Code, add the same `agent-browser mcp` command to that tool's own MCP
config (`opencode.json` `mcp`, `~/.codex/config.toml` `[mcp_servers.*]`, `~/.mavis/mcp/mcp.json`).
After registering, **restart the agent** so it loads the MCP subprocess. Until then, use the CLI.

### E2E recipe (CLI)

```bash
agent-browser open https://admin-techsolutions.vendix.com   # real vhost, NOT localhost:4200
agent-browser snapshot -i                                   # interactive elements with @e refs
agent-browser fill @e2 "owner@techsolutions.co"             # use refs from the snapshot
agent-browser fill @e3 "1125634q"
agent-browser click @e4                                     # submit
agent-browser wait --load networkidle
agent-browser get text @e1                                  # assert post-login state
agent-browser screenshot /tmp/after-login.png               # optional, for a vision check
agent-browser close
```

- `snapshot -i -c` (interactive + compact) keeps the tree small for reasoning; `-s "#sel"` scopes it.
- Prefer **refs** (`@e2`) from a fresh snapshot, or semantic locators (`find role button --name "..."`).
- `batch "open ..." "snapshot -i" "click @e1"` runs several steps in one call (less overhead).
- Self-signed cert: trust `ssl/ca/ca-cert.pem` or use the browser TLS-ignore option (confirm the flag
  via `agent-browser open --help`).

## Decision Rules

| Situation | Use |
| --- | --- |
| API contract / status code / response shape | `curl` |
| Auth or permission boundary (200 vs 403) | `curl` with/without the right token |
| Login flow as a user sees it | `agent-browser` against the vhost |
| Navigation, form submit, modal, list render | `agent-browser` snapshot + act + assert |
| "Does it compile / boot?" | `buildcheck-dev` (Docker logs), not this skill |
| Visual design / "does it look right?" | `agent-browser screenshot` + human or vision model |
| Async/queue side-effect | `curl` to read state + `docker logs` (see `buildcheck-dev`) |
| Developer explicitly wants a saved `.bru` test | `vendix-bruno-test` (opt-in only) |

## Anti-Patterns

| Anti-pattern | Correct alternative |
| --- | --- |
| Hitting `http://localhost:4200` for a frontend flow | Use the real vhost; `localhost` fails domain resolution |
| Running a `.bru` Bruno test as agent verification | `curl` for API; Bruno is opt-in human-driven only |
| Reading the token from a JWT claim | Read `data.access_token`; permissions from `data.permissions` |
| Inventing test credentials | Use a seed account or ask the user |
| Clicking by guessed CSS selectors | Snapshot first, click by `@e` ref or semantic locator |
| Claiming a UI fix works because the build passed | Build green ≠ flow works; run the E2E recipe |
| Assuming an SSL/TLS flag exists | Verify with `agent-browser open --help` first |

## Related Skills

- `how-to-plan` — picks verification mechanisms per step; this skill is the catalog's runtime detail.
- `how-to-dev` — requires running verification before claiming completion.
- `buildcheck-dev` — build/compile/runtime-log health (run first; complements this skill).
- `vendix-bruno-test` — opt-in Bruno template; never an agent verification path.
- `vendix-app-architecture` / `vendix-frontend-domain` — why hostname drives `app_type` resolution.
- `vendix-backend-auth` / `vendix-customer-auth` — login endpoints, token shape, permissions model.
- `vendix-backend-api` — endpoint conventions and pagination shape for curl checks.
