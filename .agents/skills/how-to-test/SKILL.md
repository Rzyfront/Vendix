---
name: how-to-test
description: >
  Runtime verification methodology for Vendix: curl for API/auth contracts and Playwright MCP for
  frontend end-to-end flows, run against the real local vhost (vendix.com). Every feature must be
  tested across THREE mandatory flow schemes — Happy Path, Sad Path, and Brute-Force.
  Trigger: Verifying an API endpoint or auth boundary with curl, running an end-to-end frontend
  flow, driving a browser to confirm UI behavior, designing happy/sad/brute-force test flows,
  security or data-integrity probing of a flow, installing or configuring Playwright MCP (with agent-browser as fallback), or
  choosing test credentials (seed accounts vs user-provided).
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke:
    - "Verifying an API endpoint or auth boundary with curl"
    - "Running an end-to-end frontend flow in a browser"
    - "Driving a browser to confirm UI behavior with Playwright MCP"
    - "Designing happy-path, sad-path, or brute-force test flows for a feature"
    - "Security, abuse, or data-integrity probing of a specific flow"
    - "Installing or configuring Playwright MCP (agent-browser as fallback)"
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
| `Playwright MCP` | End-to-end frontend flows the user actually sees (login, navigation, forms, render) | Frontend |

This skill governs **functional/E2E verification**. It does **not** govern build/compile/runtime-log
checks — those belong to `buildcheck-dev`. The two are complementary: `buildcheck-dev` proves the
code *compiles and boots*; `how-to-test` proves it *behaves correctly*.

## Test Flow Types — three mandatory schemes (HIGHEST PRIORITY)

> **A feature is NOT verified until it passes ALL THREE flow schemes below.** Testing only the happy
> path is incomplete work and must be reported as "not tested". This is the top-priority rule of this
> skill: every module / feature / endpoint under test gets **Happy + Sad + Brute-Force** coverage,
> each executed completely and correctly with `curl` (API/auth) and/or `Playwright MCP` (frontend E2E).
> No "it renders, ship it". Each scheme answers a different question; run them in order, because a
> failure in an earlier scheme usually invalidates the later ones.

### 1. Happy Path — "camino feliz" (does it work as designed?)

- **Goal:** exercise every flow a real user takes when using the feature **exactly as designed**.
- **Cover:** the primary success path end-to-end **plus every documented alternate success path** —
  each role/tenant that should succeed, each valid variant, empty→first-item, pagination, and the
  designed edit / cancel / renew / transition actions.
- **How:** `curl` the endpoint sequence with valid payloads and a token that HAS the permission;
  drive the real UI journey with **Playwright MCP** (navigate → snapshot → fill → submit → assert the rendered result).
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
- **How:** `curl` with malformed-but-honest payloads; **Playwright MCP** performing the clumsy sequence.
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
- **How:** scripted `curl` loops for authz / injection / rate / state; **Playwright MCP** for UI-level
  abuse (tamper a disabled control, resubmit, force a hidden action).
- **Pass:** every abusive attempt is **rejected with the correct status + a safe error**, the
  datastore is **unchanged** (verify with a follow-up `curl` read or SQL), and nothing leaks another
  tenant's data. **Any attempt that succeeds is a blocking bug — report it and do not proceed.**

### Coverage matrix (fill one per feature under test)

| Flow / story | Happy ✅ | Sad ⚠️ | Brute 🔒 | Mechanism | Evidence |
| --- | --- | --- | --- | --- | --- |
| `HU-x.y — <flow>` | 2xx + correct state | 4xx + clear message, no partial write | 403/400, data intact, no cross-tenant leak | curl / Playwright MCP | command + observed result |

A feature is "verified" only when **every row has all three schemes green** (or a documented,
user-accepted risk). Report the matrix as the test result — not a single "it works".

## Core Rules

- **Every feature is tested across all three flow schemes — Happy + Sad + Brute-Force (see the
  section above). This is the highest-priority rule.** Happy-path-only verification is treated as
  incomplete and must not be reported as "tested". Run each scheme completely with `curl` and/or
  `Playwright MCP`.
- **Step 0 — confirm the local dev server is healthy with `buildcheck-dev` BEFORE running any test.**
  This is the gate every other check depends on. A container showing `Up` is **not** proof it works:
  the Node process can crash on boot while the container stays `Up` (a `MODULE_NOT_FOUND` in
  `auth.service.ts` surfaces as nginx `502`, not a stopped container). Check Docker watch-mode **logs**
  and `curl -fsS http://localhost:3000/api/health`, never just `docker ps`. If the server is unhealthy,
  fix that first — no `curl` or `Playwright MCP` result is valid against a broken server.
- **`curl` is the primary mechanism for API and auth verification. Never run Bruno (`.bru`) as agent
  verification** — Bruno is an opt-in template (`vendix-bruno-test`) only when a human explicitly asks.
- **Playwright MCP is the mechanism for frontend E2E.** It drives a real Chromium via `mcp__playwright__browser_*` tools and sees the page as an accessibility tree (roles + labels + `ref` ids), not pixels — deterministic, not CSS-selector-fragile. It also inspects network + console (`browser_network_requests`, `browser_console_messages`) to confirm API calls fire and catch zoneless/signals errors the DOM never shows. It verifies *behavior*, not visual design (design judgment needs a screenshot + a vision model). `agent-browser` stays installed as a scoped fallback — see Mechanism 2.
- **Always reach the frontend through the real vhost (`https://vendix.com` and its subdomains), not
  `http://localhost:4200`.** The frontend resolves its `app_type` by hostname via
  `GET /api/public/domains/resolve/{hostname}` (`apps/frontend/src/app/core/services/app-config.service.ts`).
  `localhost` has no `domain_settings` row, so the app cannot resolve which app to render and
  bootstraps wrong. The hostname *is* the test fixture.
- **A dedicated store/org subdomain is OPTIONAL — the default vhost `vendix.com` (frontend) and
  `api.vendix.com/api` (backend) serve EVERY tenant.** If a store or organization has no subdomain
  provisioned (no `domain_settings` row for it), do **not** treat that as a blocker: log in on the
  default vhost and pass the `organization_slug` (or `store_slug`) in the login payload — the slug,
  not the hostname, selects the tenant in that case. `curl` against `https://api.vendix.com/api` with
  `{"...","organization_slug":"<slug>"}` and `Playwright MCP` against `https://vendix.com` both work
  for any tenant this way. Use a subdomain only when the flow under test specifically depends on
  hostname-based `app_type` resolution (e.g. a storefront ecommerce render); for admin/API flows the
  default vhost + slug is sufficient and preferred when no subdomain exists.
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
   These three defaults are enough for **any** tenant: a per-store/org subdomain is **optional**.
   Add one only if the flow needs hostname-based `app_type` resolution (e.g. a storefront render);
   the full set lives in `apps/backend/prisma/seeds/domains.seed.ts`. For admin/API flows, stay on
   `vendix.com` / `api.vendix.com` and select the tenant with `organization_slug` (or `store_slug`)
   in the login payload — no subdomain, no extra `/etc/hosts` entry required.
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
   server first** — every curl / Playwright MCP step below is invalid against a broken server.
3. **Containers & ports** (`docker-compose.yml`, `nginx.conf`):

   | Container | Port | Vhost |
   | --- | --- | --- |
   | `vendix_frontend` | 4200 | `vendix.com`, `www.vendix.com` → 443 |
   | `vendix_backend` | 3000 | `api.vendix.com` → 443 |
   | `vendix_postgres` | 5432 | — |
   | `vendix_redis` | 6379 | — |
   | `vendix_nginx` | 80, 443 | TLS proxy (self-signed wildcard `*.vendix.com`) |

4. **SSL:** the cert is a self-signed wildcard. Either trust the CA (`ssl/ca/ca-cert.pem`, see
   `ssl/README-INSTALLATION.md`) or pass curl `-k`; for the E2E browser, launch **Playwright MCP**
   with `--ignore-https-errors` — a single context-level flag that covers the page **and** every
   subresource fetch (see Mechanism 2).
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

Need a role/tenant the seeds don't cover → **ask the user** for `slug`, `email`, `password`. The
"typical vhost" column is the convenience subdomain, **not** a requirement: any persona also logs in
on the default `vendix.com` / `api.vendix.com` by supplying its `organization_slug` (or `store_slug`).
Only when you deliberately test hostname-based `app_type` resolution do you confirm the subdomain in
`domains.seed.ts` and add it to `/etc/hosts`.

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

## Mechanism 2 — Playwright MCP (frontend E2E) — PRIMARY

**Playwright MCP** (`@playwright/mcp`) is the **primary engine** for frontend end-to-end verification. The agent drives a real Chromium through MCP tools prefixed `mcp__playwright__browser_*`. Workflow: **navigate → snapshot → act → assert → close**. It sees the page as an accessibility tree (roles + labels + `ref` ids), not pixels — deterministic, not CSS-selector-fragile.

Why it is primary over `agent-browser`: it adds **network + console inspection** (`browser_network_requests`, `browser_console_messages`) — indispensable to confirm API calls fire and to catch zoneless/signals JS errors the DOM never shows — plus cleaner (cheaper-token) snapshots and reusable `page.*` code for graduating a check into a `.spec.ts`. `agent-browser` remains a scoped fallback (see below).

### ⚠️ Vendix convention — local vhost self-signed cert (REQUIRED, one flag)

Vendix local vhosts (`vendix.com`, `api.vendix.com`, `*.vendix.com`) use a **self-signed wildcard cert**. The frontend also resolves its `app_type` by fetching `https://api.vendix.com/api/public/domains/resolve/{hostname}`; if the browser does not trust the cert that `fetch` dies in the **TLS handshake**, and the frontend treats *any* resolution failure as "this is the platform" and silently falls back to `AppType.VENDIX_LANDING` (`route-manager.service.ts`) — so a store/ecommerce subdomain renders the platform landing instead of the storefront.

Launch Playwright MCP with **`--ignore-https-errors`**. This sets `ignoreHTTPSErrors: true` at the browser-**context** level, so it covers **both** the main navigation **and** every subresource `fetch`/XHR (including the `app_type` resolve call) with a **single** flag. This is the key difference from `agent-browser`, which needed **two** flags (`--ignore-certificate-errors` + `--ignore-https-errors`) because its cert-ignore only reached the CDP layer, not Chrome's own page fetches.

Playwright MCP runs a **headed** browser by default, so the dev sees the session — no extra headed flag is needed locally.

> **Scope: LOCAL testing only.** This trusts the local self-signed cert in the test browser; it is NOT a production fix. On prod (`www.vendix.online`, valid public cert) the flag is harmless and unnecessary.

### Install / configure Playwright MCP if missing

If the `mcp__playwright__browser_*` tools are not available, the dev must add the MCP server:

```bash
# Claude Code — register the MCP with the REQUIRED local cert flag
claude mcp add playwright --scope user -- npx @playwright/mcp@latest --ignore-https-errors
npx playwright install chrome        # one-time Chromium/Chrome download
```

Then **restart the agent** so it reloads the MCP subprocess. Verify with a `browser_navigate` to `https://vendix.com` (it should render the app, not a TLS error page).

For other agents, add the same command to that tool's MCP config — always keep `--ignore-https-errors`:

| Agent | Config file | Entry |
| --- | --- | --- |
| Claude Code | `claude mcp add …` (above) | `npx @playwright/mcp@latest --ignore-https-errors` |
| OpenCode | `opencode.json` → `mcp` | `command: ["npx","@playwright/mcp@latest","--ignore-https-errors"]` |
| Codex | `~/.codex/config.toml` → `[mcp_servers.playwright]` | `command="npx"`, `args=["@playwright/mcp@latest","--ignore-https-errors"]` |
| Gemini CLI | `.gemini/settings.json` → `mcpServers.playwright` | same `npx` command + arg |

### E2E recipe (Playwright MCP tools)

```ts
browser_navigate({ url: "https://admin-techsolutions.vendix.com" })
browser_snapshot()                                  // a11y tree with ref ids — read refs from here
browser_type({ element: "email input",    ref: "e12", text: "owner@techsolutions.co" })
browser_type({ element: "password input", ref: "e13", text: "1125634q" })
browser_click({ element: "submit button", ref: "e14" })
browser_wait_for({ text: "Dashboard" })             // assert the post-login rendered state
browser_network_requests()                          // confirm resolve/{hostname} = 200 + API calls fired
browser_console_messages()                          // catch zoneless/signals JS errors
browser_take_screenshot({ filename: "after-login.png" })   // evidence (saved to a file)
browser_close()
```

- `browser_snapshot()` can scope a large tree with `target` / `depth` and dump it to `filename`.
- Prefer **refs** from a fresh snapshot; re-snapshot after any navigation/DOM change (refs go stale).
- `browser_fill_form({ fields: [...] })` fills several inputs in one call.
- Multi-tenant login without a subdomain: `browser_navigate` to `https://vendix.com` and pass the `organization_slug` (or `store_slug`) in the login form — the slug, not the hostname, selects the tenant.

### Fallback — agent-browser (only when Playwright MCP cannot)

Keep `agent-browser` installed as a **support** MCP. Reach for it ONLY for the few things Playwright MCP does not do:

| Need | agent-browser tool | Why Playwright MCP falls short |
| --- | --- | --- |
| Wait for an arbitrary **CSS selector** to appear/disappear | `agent_browser_wait_for_selector` | `browser_wait_for` waits on text or time, not a selector |
| **Explicit manual scroll** (lazy-load, IntersectionObserver, sticky header, echarts height) | `agent_browser_scroll` | Playwright only auto-scrolls into view on interaction |
| Read a page as **text/markdown** (readability) | `agent_browser_read` | Playwright snapshot is an a11y tree, not article text |
| Grab a single value without a full snapshot | `agent_browser_get_text` / `get_title` / `get_url` | Playwright needs `browser_evaluate` |
| Run where **Node/npx is unavailable** | self-contained Rust binary | Playwright MCP needs Node |

If you do fall back locally, `agent-browser` needs **both** cert flags: `--headed --ignore-certificate-errors --ignore-https-errors`. Its fallback install: `brew install agent-browser` → `agent-browser install` → `claude mcp add agent-browser --scope user -- agent-browser mcp`.

## Decision Rules

| Situation | Use |
| --- | --- |
| Any feature "done" claim | All three schemes (Happy + Sad + Brute) — report the coverage matrix |
| Flow used as designed | **Happy Path** scheme via `curl` / **Playwright MCP** |
| Accidental misuse / confused user / bad input | **Sad Path** scheme — assert a safe 4xx + clear message |
| Security, abuse, tenant isolation, data-integrity | **Brute-Force** scheme — assert rejection, data intact |
| API contract / status code / response shape | `curl` |
| Auth or permission boundary (200 vs 403) | `curl` with/without the right token |
| Login flow as a user sees it | **Playwright MCP** against the vhost |
| Navigation, form submit, modal, list render | **Playwright MCP** snapshot + act + assert |
| "Does it compile / boot?" | `buildcheck-dev` (Docker logs), not this skill |
| Visual design / "does it look right?" | **Playwright MCP** `browser_take_screenshot` + human or vision model |
| Async/queue side-effect | `curl` to read state + `docker logs` (see `buildcheck-dev`) |
| Developer explicitly wants a saved `.bru` test | `vendix-bruno-test` (opt-in only) |
| Confirm an API call fired / catch a console error during a UI flow | **Playwright MCP** `browser_network_requests` / `browser_console_messages` |
| Wait on a CSS selector, manual scroll, or read page markdown | **agent-browser** (fallback) — see Mechanism 2 |

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
| Clicking by guessed CSS selectors | Snapshot first, click by `ref` from `browser_snapshot` |
| Claiming a UI fix works because the build passed | Build green ≠ flow works; run the E2E recipe |
| Guessing extra TLS flags for the local vhost | The local self-signed vhost needs exactly `--ignore-https-errors` on the Playwright MCP server (one context-level flag covers page + subresources) |

## Related Skills

- `how-to-plan` — picks verification mechanisms per step; this skill is the catalog's runtime detail.
- `how-to-dev` — requires running verification before claiming completion.
- `buildcheck-dev` — build/compile/runtime-log health (run first; complements this skill).
- `vendix-bruno-test` — opt-in Bruno template; never an agent verification path.
- `vendix-app-architecture` / `vendix-frontend-domain` — why hostname drives `app_type` resolution.
- `vendix-backend-auth` / `vendix-customer-auth` — login endpoints, token shape, permissions model.
- `vendix-backend-api` — endpoint conventions and pagination shape for curl checks.
