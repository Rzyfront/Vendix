---
name: verify-ticket-prod
description: >
  Controlled, non-destructive production verification that a Linear ticket is correctly deployed and
  behaves as its requirement demands. Drives agent-browser E2E against the live app at
  www.vendix.online, ALWAYS logged in as the demo account (never a real tenant). Runs Happy Path and
  Sad Path like how-to-test, plus a non-destructive Controlled Probe that OBSERVES weaknesses and
  REPORTS them instead of breaking the system; also reports any disparity between observed behavior
  and the ticket requirement.
  Trigger: Verifying a Linear ticket / Vendix issue is correctly applied in production, running a
  controlled E2E verification of a shipped ticket on www.vendix.online, confirming a production fix
  matches its requirement or reporting defects/anomalies, or doing non-destructive production
  verification with the demo account.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Verifying a Linear ticket is correctly applied in production"
    - "Running a controlled E2E verification of a shipped ticket on www.vendix.online"
    - "Confirming a production fix matches its requirement or reporting defects"
    - "Non-destructive production verification with the demo account"
allowed-tools: Read, Bash, Glob, Grep
---

# Verify Ticket in Production

## Purpose

Define **how an agent confirms, in production, that a Linear ticket is actually applied and behaves
as its requirement demands** — or surfaces where it fails, is incomplete, or diverges from the
requirement. Verification is done **end-to-end through the live UI** with `agent-browser`, always as
the **demo account**, and always **without breaking anything**.

This skill governs **production ticket verification only**. It does **not** govern:

- Local runtime verification → `how-to-test` (local vhost `vendix.com`, seed accounts, Docker).
- Build/compile/boot health → `buildcheck-dev`.
- Reading / updating the ticket itself → `linear-issues`.
- Deep prod infrastructure diagnosis (SSH, AWS, logs) → `vendix-cloud-operations` (out of scope
  here — this skill only observes the app through the browser).

It reuses the **three-flow-scheme discipline** of `how-to-test` (Happy + Sad + a third scheme), but
the third scheme is **redefined for production**: it does not try to break the system — it probes
carefully to *identify* weaknesses and *reports* them.

## Critical Safety Rules (HIGHEST PRIORITY — read first)

> This runs against **live production**. The rules below are inviolable. A single destructive action
> on prod is a serious incident, not a test failure.

1. **Environment is ALWAYS `https://www.vendix.online`** (production). Never point this skill at
   `localhost`, the local `vendix.com` vhost, or staging unless the user explicitly redirects it.
2. **Log in ONLY as the demo account — NEVER a real tenant, customer, or staff account.** The demo
   org is the entire blast radius; a real account is off-limits even for read-only checks.

   | Field | Value |
   | --- | --- |
   | `organization_slug` | `vendix` (display name **"Vendix Electronics"**) |
   | `email` | `vendix.demo@gmail.com` |
   | `password` | `vendixDEMO@#$1` |

   The demo account is a **multi-store owner** ("Dueño") — one org, several stores, each a test bench
   for a different industry. See **Demo Account — multi-store test bench** below for the store roster
   and how to switch between them.

   If a ticket can only be verified with a non-demo tenant, **stop and report that** — do not
   substitute a real account.
3. **Non-destructive by default.** Prefer read / navigate / observe. A write is allowed only when the
   flow under test requires it (e.g. the ticket is "create order"), it is scoped to the demo org, and
   it is reversible or self-cleaning. **Never** trigger irreversible or outward-facing side effects on
   prod: real payments/charges, emails/SMS/WhatsApp/push to real recipients, bulk operations, hard
   deletes, or anything that touches another tenant.
4. **Never attack production.** No rate/quota hammering, no scripted request floods, no DoS-shaped
   loops, no credential cracking, no injection payloads meant to execute. On prod you **reason about**
   and **observe** a weakness through the UI and **report** it — you do not exploit it.
5. **When a state or flow *could* break the system, DO NOT push it through — report it.** The proof in
   production is a written finding, not a triggered break. Stop at the last safe, observable step.
6. **Report every disparity or anomaly** between what the ticket requires and what production does —
   even cosmetic or partial mismatches. "Deployed but wrong" and "deployed but incomplete" are
   distinct verdicts from "works".

## Demo Account — multi-store test bench

The demo login is an **owner ("Dueño") of one organization** (`vendix` / "Vendix Electronics") that
holds **several stores, each specialized to exercise a different industry/sector**. Pick the store
whose industry matches the ticket under test — a restaurant ticket is verified in the restaurant
store, a gym/membership ticket in the gym store, and so on.

### Store roster (org "Vendix Electronics", 8 stores)

| Store name | `store_slug` | Industry focus (confirmed by the user) |
| --- | --- | --- |
| Vendix Smart Gym | `suple-deportivo-y-salud` | Gym / memberships / sports supplements & health |
| Vendix Ferreterias | `tuerca-mia` | Hardware store (ferretería) **+ online sales with dispatch & mass shipping-route control** (DSD / dispatch routes) — highest data volume (~108 users) |
| Vendix Style Men | `baxter` | Men's fashion **retail only** (no services/barber) |
| Vendix Aura Care Spa | `aura-care` | Spa / wellness / beauty (bookings & services) |
| Vendix Moto & Car Parts and Services | `moto-and-car` | Automotive parts & services (moto/car) |
| Vendix Miramor Restaurant | `miramor` | Restaurant (tables, KDS, menus/cartas, recipes) |
| Vendix Electronics | `e-tech` | Specialized tech retail with **serial-number tracking on tech products + rigorous inventory control** |
| Vendix Demo | `vendix-demo` | Generic demo / sandbox store |

> Pick the store by the flow the ticket touches: dispatch-routes / bulk-shipping / online-order
> tickets → `tuerca-mia`; serialized-product / strict-inventory tickets → `e-tech`; restaurant →
> `miramor`; gym/membership → `suple-deportivo-y-salud`; spa/bookings → `aura-care`; automotive
> services → `moto-and-car`; men's fashion retail → `baxter`; anything generic → `vendix-demo`.

### Switching store ⇄ organization (Store app)

The demo owner starts inside one store's **Store app**. To reach another store's flow:

1. Open the **user menu** (top-right avatar — shows "Vendix Demo / Dueño").
2. Click **"Administrar Organización"** → switches scope from the current **store** to the
   **organization** (org-admin view).
3. In the org view open the stores list (**"Todas las tiendas (8)"**) and **click the target store's
   row** to enter that store's Store app.
4. Confirm the active store (header / user menu) before running any scheme — verifying the right
   ticket in the wrong store is a silent false result.

> **Gotcha — module activation:** the demo user menu may show "*N módulos nuevos disponibles.
> Actívalos en Configuración*". If a ticket's module/flow is not visible in the target store, check
> **Configuración de usuario** (user settings) for a module that must be activated first — a missing
> module here is a visibility/config state, not necessarily a "not deployed" verdict.

## Verification Verdicts

Every run ends in exactly one verdict, backed by evidence:

| Verdict | Meaning |
| --- | --- |
| ✅ **Matches** | The ticket is deployed and every acceptance criterion passes Happy + Sad; the Controlled Probe found no unreported risk. |
| ⚠️ **Deployed with defects** | The feature is present but a Sad Path fails unsafely, a criterion is partially met, or the Probe surfaced a real risk/anomaly. List each defect. |
| ❌ **Does not match requirement** | The behavior in prod contradicts or omits the ticket requirement (wrong result, missing flow, regression). |
| ⛔ **Not deployed / not reachable** | The change is absent in prod, or the flow can't be reached (login fails, page errors, demo account can't access it). |
| 🚫 **Blocked** | Verification needs a real (non-demo) tenant or a destructive action — cannot proceed safely. Report why. |

## Workflow

1. **Read the ticket** (`linear-issues`): capture the **requirement, acceptance criteria, and the
   exact flow(s)** it touches. Note the expected result of each criterion — that is your oracle. If
   the ticket is vague, record the ambiguity as part of the report.
2. **Map the ticket to concrete flows and pick the matching store.** Choose the demo store whose
   industry matches the ticket (see **Demo Account — multi-store test bench**) — e.g. restaurant →
   `miramor`, gym/membership → `suple-deportivo-y-salud`, spa/bookings → `aura-care`, dispatch-routes /
   bulk-shipping / online orders → `tuerca-mia`, serialized products / strict inventory → `e-tech`,
   automotive services → `moto-and-car`, men's fashion retail → `baxter`. If the flow needs data the
   store lacks, plan a minimal, reversible setup step (or report as `Blocked` if setup would be
   destructive).
3. **Step 0 — confirm prod is reachable and the demo login works.** Open `https://www.vendix.online`,
   confirm it renders (not an error page), and complete the demo login. A failed login or an error
   page = `Not deployed / not reachable`; stop. (Prod uses a **valid public TLS cert** — the
   self-signed cert flags from `how-to-test` are **not** needed here; keep `headed: true` so the prod
   session is observable.)
   Then **switch to the target store**: user menu → "Administrar Organización" → click the store row
   → confirm the active store before proceeding (see the switching steps below).
4. **Happy Path** — exercise the ticket's flow exactly as designed and assert every acceptance
   criterion against the ticket's expected result. Cover each valid variant/role the demo account can
   represent.
5. **Sad Path** — exercise the flow the way a confused/uninformed demo user would (out-of-order,
   empty/boundary inputs, abandon/resume, stale form). Assert it **fails safely**: clear validation
   error, no crash, no half-written state, no misleading success toast.
6. **Controlled Probe (non-destructive)** — see the scheme below. Observe for authz/isolation gaps,
   illegal state transitions, and data-integrity risks **without executing the break**. Anything
   suspicious becomes a finding, not an exploit.
7. **Compare to the requirement** — resolve to one verdict. Every "pass" claim must trace to an
   acceptance criterion and an observed result.
8. **Report** — deliver the coverage matrix + verdict + evidence (see Reporting). Update the Linear
   ticket status only if the user asks or the team flow requires it (`linear-issues` /
   `pr-code-review`).

## The Three Flow Schemes (production-adapted)

Reuse `how-to-test` for the mechanics of Happy and Sad. The difference is the **third scheme**.

### 1. Happy Path — does prod do what the ticket promised?
As in `how-to-test`: primary success path + every documented alternate success path, end-to-end via
`agent-browser`, asserting the ticket's acceptance criteria. Pass = correct rendered outcome + every
designed side-effect that is safe to observe on prod.

### 2. Sad Path — does prod fail safely when misused by accident?
As in `how-to-test`: out-of-order actions, boundary/format inputs a real user might type,
abandon/resume, wrong-but-owned data. Pass = safe 4xx-equivalent UX (clear message, no crash, no
partial write, no false success). All performed as the demo account, non-destructively.

### 3. Controlled Probe — identify weaknesses WITHOUT breaking prod
> **This replaces `how-to-test`'s brute-force scheme.** Intent is *detection and reporting*, never
> destruction. You look for the weak doors and **describe them**; you do not kick them in.

- **Observe, don't exploit.** For each potential weakness, reach the last safe observable step, note
  what *would* happen, and stop. If confirming it requires an action that could corrupt state, leak
  another tenant's data, or break the system → **report it as a risk instead of performing it.**
- **Isolation / authz (read-only observation):** as the demo account, try to *navigate* to a resource
  that should be out of scope (another tenant's id in a URL, an action the demo role shouldn't see).
  Expect a block/redirect. If prod actually returns another tenant's data → **stop immediately, do not
  read further, report a cross-tenant leak** (blocking).
- **Illegal state transitions:** look for a guard the ticket should enforce (e.g. cancel an
  already-cancelled order, renew a cancelled membership, double-submit). Approach the transition and
  observe whether the guard blocks it. If the guard is **missing** and proceeding would corrupt state,
  **do not proceed — report the missing guard.**
- **Data-integrity / invariants:** look for inputs that *would* violate an invariant (negative amount,
  payment > total, stock below zero, unbalanced entry). Observe whether the UI/validation refuses. Do
  not force the corrupt write on prod; a refused attempt is a pass, a *would-succeed* attempt is a
  reported risk.
- **Explicitly forbidden on prod:** rate/quota hammering, request floods, injection payloads intended
  to execute, and any scripted attack loop. Reason about these; never run them.
- **Pass:** no unreported risk remains. Every observed weakness, disparity, or anomaly is written up
  with enough detail to reproduce safely.

## Coverage Matrix (report this, not "it works")

| Ticket criterion / flow | Happy ✅ | Sad ⚠️ | Probe 🔒 | Evidence | Finding |
| --- | --- | --- | --- | --- | --- |
| `QUI-x — <criterion>` | expected result observed | safe failure, clear message | no unreported risk / risk described | agent-browser step + screenshot | matches / defect / anomaly |

A ticket is "verified" only when every criterion has Happy + Sad + Probe resolved (green or a written
finding), ending in one verdict from the table above.

## agent-browser on Production

Reuse the `how-to-test` agent-browser recipe (open → snapshot → act → assert → close, refs from a
fresh `snapshot -i`), with these production differences:

- **URL:** always `https://www.vendix.online`.
- **`headed: true`** — keep the prod session observable to a human.
- **Cert flags NOT required** — prod serves a valid public cert, unlike the local self-signed vhost.
  (If, and only if, an open fails on TLS, confirm the domain/cert before adding any override.)
- **Login:** fill the demo `email` / `password` and `organization_slug: vendix` in the staff login
  form. Confirm you are inside the **demo** org before any further step.
- Prefer `snapshot`, `get_text`, and `screenshot` (observation) over write actions. Screenshot each
  asserted state — screenshots are the primary evidence for a prod verdict.

```ts
agent_browser_open(url="https://www.vendix.online", headed=true)
// snapshot -i → fill demo email/password + organization_slug "vendix" → submit → assert demo org
```

## Reporting

Deliver:

1. **Verdict** (one of the five) + one-line justification.
2. **Coverage matrix** with per-criterion Happy/Sad/Probe results.
3. **Findings**: each defect, disparity, anomaly, or unmitigated risk — with the flow, the safe repro
   steps, the observed vs. required behavior, and a screenshot. Mark cross-tenant leaks or would-break
   states as **blocking**.
4. **Evidence**: screenshots + the agent-browser step sequence.

Update Linear only when asked / when the team flow requires it (`linear-issues`, `pr-code-review`).
Never mark a ticket "verified" on prod from a build-passing or happy-path-only signal.

## Decision Rules

| Situation | Action |
| --- | --- |
| Verify a shipped ticket in prod | This skill: demo account on `www.vendix.online`, all three schemes |
| Ticket needs a non-demo tenant to verify | Verdict `Blocked` — report, do not use a real account |
| A flow would require a destructive/irreversible prod action to confirm | Stop, report the risk — do not perform it |
| Prod returns another tenant's data | Stop reading, report cross-tenant leak (blocking) |
| Local pre-merge verification | `how-to-test` (not this skill) |
| "Does it compile / boot?" | `buildcheck-dev` |
| Read or update the ticket | `linear-issues` |
| Deep prod infra diagnosis (logs, SSH, AWS) | `vendix-cloud-operations` |

## Anti-Patterns

| Anti-pattern | Correct alternative |
| --- | --- |
| Verifying with a real tenant/customer account | Demo account only (`vendix` / `vendix.demo@gmail.com`) |
| Hammering / flooding / injecting against prod to "prove" a hole | Observe the weakness, stop at the safe step, report it |
| Forcing a corrupt write or illegal transition on prod to confirm a missing guard | Report the missing guard as a risk — do not corrupt state |
| Reporting "works" from happy path only | Run Happy + Sad + Controlled Probe and report the matrix + verdict |
| Adding self-signed cert flags on prod | Prod has a valid cert; only override after confirming a real TLS issue |
| Marking a ticket verified because the build passed | Build/deploy ≠ behaves; verify the flow E2E |
| Reading further after seeing another tenant's data | Stop immediately; that read is itself the incident to report |

## Related Skills

- `how-to-test` — the E2E mechanism (agent-browser recipe) and the three-flow-scheme discipline this
  skill adapts for production.
- `linear-issues` — read the ticket requirement/criteria and update its status.
- `pr-code-review` — pairing a code review verdict with this runtime prod verdict.
- `vendix-cloud-operations` — deeper prod diagnosis when browser observation is not enough (out of
  scope for the verification itself).
- `vendix-multi-tenant-context` / `vendix-prisma-scopes` — the tenant-isolation invariants the
  Controlled Probe checks for.
