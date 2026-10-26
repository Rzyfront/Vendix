---
name: how-to-test
description: >
  Vendix runtime verification: user story first, then curl (API/auth) and Playwright MCP (UI on the vendix.com vhost) across happy/sad/brute flows with seed credentials.
  Trigger: verifying an endpoint, auth boundary or UI flow.
license: MIT
metadata:
  author: rzyfront
  version: "3.0"
  scope: [root]
allowed-tools: Read, Bash, Glob, Grep
---

# How To Test

Proves a change **behaves** correctly at runtime. Compile/boot health is `buildcheck-dev`;
production ticket verification is `verify-ticket-prod`.

## 1. User story first (mandatory)

Before any command, write each case as:

- **Historia:** "Como <rol> en <entorno>, quiero <funcionalidad> para <resultado>".
- **Pasos en pantalla:** numbered steps a person follows (screen, button, field, value).
- **Criterios de aceptación observables:** what the person sees (message, row, total, badge, redirect).
- Technical notes (endpoint, payload, status, table) go **below**, never instead of the story.

When starting from a ticket, translate it into this story before testing.

## 2. Three schemes, all mandatory

A feature is verified only when every story passes **Happy + Sad + Brute-Force**. Happy-only = "not tested".

| Scheme | Question | Pass |
| --- | --- | --- |
| Happy | Does it work as designed (every role, variant, alternate success path)? | 2xx + correct state; UI shows the designed outcome; side-effects fire |
| Sad | What happens when a confused user gets it wrong (out-of-order, bad input, abandon/resume, stale form)? | Safe 4xx + clear message, no partial write, never a false success toast |
| Brute-Force | Does it resist abuse (IDOR, cross-tenant, mass-assignment, injection, quota, races, illegal transitions, money invariants)? | Rejected with correct status, data unchanged, no leak. Any success = blocking bug |

Brute-Force is local/dev with seed data only; one proof per hole, never exploit further.
Detail: `references/flow-schemes.md` (read on demand).

## 3. Step 0 — healthy stack

Stack: db, redis, backend, nginx in Docker; frontend is native `ng serve` (`npm run dev:fe`, :4200)
behind nginx (`host.docker.internal:4200`). Before testing:

```bash
docker compose ps                                  # db, redis, backend, nginx Up
docker logs --tail 40 vendix_backend               # no MODULE_NOT_FOUND / Nest boot crash
curl -fsS http://localhost:3000/api/health         # really answering, not just "Up"
bash scripts/buildcheck.sh --watch                 # state of the native ng serve
curl -sk -o /dev/null -w "%{http_code}\n" https://vendix.com/   # 200 once compiled
```

- A container can be `Up` while Node crashed (nginx 502). 502 with Docker green = native `ng serve` down.
- `/etc/hosts`: `127.0.0.1 vendix.com www.vendix.com api.vendix.com`. Other subdomains only when the
  flow depends on hostname `app_type` resolution (list in `apps/backend/prisma/seeds/domains.seed.ts`).
- Self-signed wildcard cert: `curl -k`; Playwright MCP with `--ignore-https-errors`.
- If the stack is unhealthy, report the blocker; no result counts against a broken server.

## 4. Rules

- **Never `http://localhost:4200`**: the app resolves `app_type` via
  `GET /api/public/domains/resolve/{hostname}` (`app-config.service.ts`); localhost resolves wrong.
- Default vhost serves every tenant: log in on `vendix.com` / `api.vendix.com/api` with
  `organization_slug` (or `store_slug`). Subdomain only for hostname-dependent flows (storefront).
- Credentials: seed accounts or the user. Never invent them.
- `curl` for API/auth; Playwright MCP for UI. Never Bruno as verification (`vendix-bruno-test` is opt-in).
- Build green ≠ flow works (especially zoneless/signals, `vendix-zoneless-signals`).
- A documented command that fails in dev means the doc is wrong: fix it.

## 5. Credentials (password `1125634q`, source `apps/backend/prisma/seeds/users.seed.ts`)

| Email | Role | Org slug | Store slug |
| --- | --- | --- | --- |
| `admin@vendix.online` | super_admin | `vendix` | `tienda-principal` |
| `owner@techsolutions.co` | owner | `tech-solutions` | `tech-bogota` |
| `owner@fashionretail.com` | owner | `fashion-retail` | `fashion-norte` |
| `admin@techsolutions.co` | admin | `tech-solutions` | `tech-bogota` |
| `cliente1@example.com` | customer | `tech-solutions` | `tech-bogota` |

More roles (manager, supervisor, employee) in the seed. Missing tenant/role → ask for slug, email, password.

## 6. curl (API & auth)

Token is `data.access_token`; permissions are `data.permissions` (not in the JWT). Staff login takes
`organization_slug` **or** `store_slug`; customers use `POST /api/auth/login-customer` with numeric `store_id`.

```bash
TOKEN=$(curl -sk -X POST https://api.vendix.com/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"owner@techsolutions.co","password":"1125634q","organization_slug":"tech-solutions"}' \
  | jq -r '.data.access_token')
curl -sk -H "Authorization: Bearer $TOKEN" https://api.vendix.com/api/store/orders | jq '.data | length'
```

- Fallback base URL without TLS: `http://localhost:3000/api`. Check `success`, not only the HTTP code.
- A `200` with HTML means the SPA catch-all answered: require `Content-Type: application/json`.
- Endpoint and pagination conventions: `vendix-backend`.

## 7. Playwright MCP (UI)

navigate → snapshot → act by `ref` → assert what the person sees → `browser_network_requests` +
`browser_console_messages` → screenshot → close. Re-snapshot after DOM changes.
Setup, recipe and `agent-browser` fallback: `references/playwright.md` (read on demand).

## 8. Report

Per story: historia, pasos ejecutados, observado vs. esperado, scheme, mechanism, evidence (command
or screenshot). Summarize as a matrix:

| Historia | Happy | Sad | Brute | Mecanismo | Evidencia |
| --- | --- | --- | --- | --- | --- |
| Como … quiero … para … | observado / esperado | … | … | curl / Playwright | comando o captura |

## Related Skills

`buildcheck-dev` (run first) · `verify-ticket-prod` (prod) · `vendix-bruno-test` (opt-in) ·
`vendix-backend-auth` / `vendix-customer-auth` (login, token) · `vendix-backend` (endpoint shape).
