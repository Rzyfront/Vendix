---
name: how-to-test
description: >
  Runtime verification methodology for Vendix: curl for API/auth contracts and agent-browser for
  frontend end-to-end flows, run against the real local vhost (vendix.com). Every feature must be
  tested across THREE mandatory flow schemes — Happy Path, Sad Path, and Brute-Force.
  Trigger: Verifying an API endpoint or auth boundary with curl, running an end-to-end frontend
  flow, driving a browser to confirm UI behavior, designing happy/sad/brute-force test flows,
  security or data-integrity probing of a flow, installing or configuring agent-browser, or
  choosing test credentials (seed accounts vs user-provided).
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke:
    - "Verifying an API endpoint or auth boundary with curl"
    - "Running an end-to-end frontend flow in a browser"
    - "Driving a browser to confirm UI behavior with agent-browser"
    - "Designing happy-path, sad-path, or brute-force test flows for a feature"
    - "Security, abuse, or data-integrity probing of a specific flow"
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

## Test Flow Types — three mandatory schemes (HIGHEST PRIORITY)

> **A feature is NOT verified until it passes ALL THREE flow schemes below.** Testing only the happy
> path is incomplete work and must be reported as "not tested". This is the top-priority rule of this
> skill: every module / feature / endpoint under test gets **Happy + Sad + Brute-Force** coverage,
> each executed completely and correctly with `curl` (API/auth) and/or `agent-browser` (frontend E2E).
> No "it renders, ship it". Each scheme answers a different question; run them in order, because a
> failure in an earlier scheme usually invalidates the later ones.

### 1. Happy Path — "camino feliz" (does it work as designed?)

- **Goal:** exercise every flow a real user takes when using the feature **exactly as designed**.
- **Cover:** the primary success path end-to-end **plus every documented alternate success path** —
  each role/tenant that should succeed, each valid variant, empty→first-item, pagination, and the
  designed edit / cancel / renew / transition actions.
- **How:** `curl` the endpoint sequence with valid payloads and a token that HAS the permission;
  `agent-browser` the real UI journey (login → navigate → fill → submit → assert the rendered result).
- **Pass:** correct 2xx + correct response shape / state transition; the UI shows the designed
  outcome; every designed side-effect fires (event → journal entry, log row, notification).

### 2. Sad Path — "camino triste" (what happens when used wrong by accident?)

- **Goal:** exercise the flow the way a **confused or uninformed user** would — not malicious, just
  wrong: poor mental model, not reading the UI, plausible-but-unusual sequences.
- **Cover (analysis of accidental misuse):**
  - **Out-of-order:** submit before filling, pay before selecting, renew a draft, double-click submit,
    back-button then resubmit, refresh mid-flow.
  - **Boundary/format a real user might type:** empty, whitespace-only, huge text, wrong date format,
    `0` / negative quantity, decimals where integers are expected, wrong currency, pasted emoji.
  - **Abandon / resume:** open a modal and close it, start a flow and navigate away, session expires
    mid-flow, stale form (edit an entity another tab already changed).
  - **Wrong-but-owned data:** a valid id of the wrong type, referencing an inactive / soft-deleted row.
- **How:** `curl` with malformed-but-honest payloads; `agent-browser` performing the clumsy sequence.
- **Pass:** the system **fails safely** — a clear validation error (correct 4xx + a human-readable,
  actionable message, see `vendix-error-handling`), no crash, no half-written state, and **never a
  misleading "success" toast on a failed write**. The user is never stuck with no way out.

### 3. Brute-Force — "fuerza bruta" (does it resist intentional abuse?)

> **Authorized, defensive QA only.** Run against **local/dev with seed data**, never production. The
> goal is to *prove the flow rejects abuse*, not to exfiltrate or destroy. Obey the global safety
> rules: never crack real credentials (use seed accounts or ask the user), never run destructive /
> unscoped writes against shared data, and **report a hole rather than exploiting it further than a
> single proof**.

- **Goal:** actively try to break the flow's **security** and **data integrity** through intentional
  misuse — hunt for the weak doors.
- **Security probes** (expect `401 / 403 / 400 / 422`, never `200 + data`):
  - **AuthZ / IDOR:** call with no token, an expired token, and a token whose role lacks the
    permission; access another tenant's resource id (cross-store / cross-org). Tenant isolation must
    hold — see `vendix-multi-tenant-context`, `vendix-prisma-scopes`.
  - **Mass-assignment:** POST extra/forbidden fields (`status`, `store_id`, `id`, `price`, `role`);
    `forbidNonWhitelisted` must reject with 400 — see `vendix-validation`.
  - **Injection:** SQL / HTML / template payloads in text fields and query params; assert they are
    parameterized / escaped, never reflected or executed.
  - **Rate / quota:** hammer a metered endpoint past its cap; the Redis quota must block, not silently
    pass or double-count on retry — see `vendix-redis-quota`.
- **Data-integrity probes** (expect a guarded rejection, never corruption):
  - Negative / overflow amounts, quantities that would drive stock below zero, duplicate unique keys,
    concurrent double-submit of the same mutation (race), replaying an idempotent op / webhook twice.
  - **Illegal state transitions:** cancel an already-cancelled order, renew a cancelled membership,
    close an already-closed period — the guard must reject, not create a corrupt state.
  - **Money / accounting invariants:** force an unbalanced entry, a payment > order total, a refund >
    paid — the invariant must hold (see `vendix-accounting-rules`, `vendix-auto-entries`).
- **How:** scripted `curl` loops for authz / injection / rate / state; `agent-browser` for UI-level
  abuse (tamper a disabled control, resubmit, force a hidden action).
- **Pass:** every abusive attempt is **rejected with the correct status + a safe error**, the
  datastore is **unchanged** (verify with a follow-up `curl` read or SQL), and nothing leaks another
  tenant's data. **Any attempt that succeeds is a blocking bug — report it and do not proceed.**

### Coverage matrix (fill one per feature under test)

| Flow / story | Happy ✅ | Sad ⚠️ | Brute 🔒 | Mechanism | Evidence |
| --- | --- | --- | --- | --- | --- |
| `HU-x.y — <flow>` | 2xx + correct state | 4xx + clear message, no partial write | 403/400, data intact, no cross-tenant leak | curl / agent-browser | command + observed result |

A feature is "verified" only when **every row has all three schemes green** (or a documented,
user-accepted risk). Report the matrix as the test result — not a single "it works".

## Core Rules

- **Every feature is tested across all three flow schemes — Happy + Sad + Brute-Force (see the
  section above). This is the highest-priority rule.** Happy-path-only verification is treated as
  incomplete and must not be reported as "tested". Run each scheme completely with `curl` and/or
  `agent-browser`.
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

### ⚠️ Vendix convention — REQUIRED flags for local vhost

Vendix local vhosts use a **self-signed wildcard cert** (`*.vendix.com`). The `agent-browser` MCP
binary hardcodes `headed: false` and **does NOT** ignore TLS by default — every `open` against the
local vhost will fail with `ERR_CERT_AUTHORITY_INVALID` unless you pass the cert flags explicitly.

**Always invoke** `agent-browser` (CLI or MCP) with **all three** of the following. Both cert flags
are required together — passing only one is not enough:

| Flag (CLI)                    | MCP (`extraArgs`)              | Reason                                                        |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------ |
| `--headed`                    | `headed: true`                 | Dev runs locally — you need to **see** the browser open      |
| `--ignore-certificate-errors` | `"--ignore-certificate-errors"` | Chrome accepts the self-signed cert (page + subresources)    |
| `--ignore-https-errors`       | `"--ignore-https-errors"`      | Ignores TLS errors on the automation/CDP layer               |

```ts
// The canonical, always-correct local invocation:
agent_browser_open(
  url="https://roku-shop.vendix.com",
  headed=true,
  extraArgs=["--ignore-certificate-errors", "--ignore-https-errors"],
)
```

**Why BOTH flags, always (empirically confirmed 2026-06-30):** the frontend resolves its `app_type`
by fetching `https://api.vendix.com/api/public/domains/resolve/{hostname}`. If Chrome does not trust
the self-signed cert, that `fetch` dies in the **TLS handshake** (`TypeError: Failed to fetch` — this
is NOT a CORS problem; CORS already allows the origin over http and https). The frontend treats *any*
resolution failure as "this is the platform" and silently falls back to `AppType.VENDIX_LANDING`
(`route-manager.service.ts:72-98`), so **an ecommerce/store subdomain renders the platform landing
instead of the storefront**. With only `--ignore-https-errors` the CDP layer is satisfied but Chrome
still blocks the page's `fetch`; you need `--ignore-certificate-errors` too. Pass both and the resolve
`fetch` returns `200` → the correct app renders. Note: the storefront's `<title>` may still read
"Vendix — Plataforma…" (static `index.html` title the ecommerce app doesn't override) — this is
cosmetic; verify the **rendered body**, not the tab title.

> **Scope: LOCAL testing only.** This is about trusting the local self-signed cert in the test
> browser — it is NOT a production fix. For a normal (non-agent) local dev browser, either trust the
> CA (`ssl/ca/ca-cert.pem`) in the OS keychain or launch Chrome with `--ignore-certificate-errors`.

The MCP server's defaults are **not** user-configurable without forking the Rust binary, so treat the
three settings above as **mandatory**. If a sub-agent forgets, the E2E is silently invalid (browser
either opens `about:blank` after a cert error, or renders the platform landing for a store subdomain).

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
# Global flags MUST come BEFORE the subcommand — pass BOTH cert flags
agent-browser --headed --ignore-certificate-errors --ignore-https-errors open https://admin-techsolutions.vendix.com
agent-browser snapshot -i                                   # interactive elements with @e refs
agent-browser fill @e2 "owner@techsolutions.co"             # use refs from the snapshot
agent-browser fill @e3 "1125634q"
agent-browser click @e4                                     # submit
agent-browser wait --load networkidle
agent-browser get text @e1                                  # assert post-login state
agent-browser screenshot /tmp/after-login.png               # optional, for a vision check
agent-browser close
```

MCP equivalent (the only way the agent can drive the browser):

```ts
agent_browser_open(
  url="https://admin-techsolutions.vendix.com",
  headed=true,
  extraArgs=["--ignore-certificate-errors", "--ignore-https-errors"],
)
```

- `snapshot -i -c` (interactive + compact) keeps the tree small for reasoning; `-s "#sel"` scopes it.
- Prefer **refs** (`@e2`) from a fresh snapshot, or semantic locators (`find role button --name "..."`).
- `batch "open ..." "snapshot -i" "click @e1"` runs several steps in one call (less overhead).
- Self-signed cert: trust `ssl/ca/ca-cert.pem` or use the browser TLS-ignore option (confirm the flag
  via `agent-browser open --help`).

## Decision Rules

| Situation | Use |
| --- | --- |
| Any feature "done" claim | All three schemes (Happy + Sad + Brute) — report the coverage matrix |
| Flow used as designed | **Happy Path** scheme via `curl` / `agent-browser` |
| Accidental misuse / confused user / bad input | **Sad Path** scheme — assert a safe 4xx + clear message |
| Security, abuse, tenant isolation, data-integrity | **Brute-Force** scheme — assert rejection, data intact |
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
| Reporting a feature "tested" after only the happy path | Run all three schemes (Happy + Sad + Brute) and report the coverage matrix |
| Brute-force testing against production or with cracked credentials | Local/dev + seed data only; never crack credentials; prove rejection, don't exploit |
| Treating a 4xx in a sad/brute test as a "failure" | A safe, clear 4xx with data intact is a PASS; a 2xx + data on abuse is the bug |
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
