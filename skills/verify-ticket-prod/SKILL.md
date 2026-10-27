---
name: verify-ticket-prod
description: >
  Non-destructive production E2E verification (Playwright, www.vendix.online, demo account only) that a Linear ticket meets its user story, then Done or Devuelto. Trigger: /verify-ticket-prod.
disable-model-invocation: true
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke:
    - "Verifying a Linear ticket is correctly applied in production"
    - "Closing a Linear ticket to Done after QA verifies it in production"
    - "Returning a failed ticket to Todo with the Devuelto label and raised priority"
    - "Running a controlled E2E verification of a shipped ticket on www.vendix.online"
    - "Confirming a production fix matches its requirement or reporting defects"
    - "Non-destructive production verification with the demo account"
allowed-tools: Read, Bash, Glob, Grep
---

# Verify Ticket in Production

Last gate of the Vendix pipeline: a ticket in `In Review` (moved there by the release, `git-workflow`
RULE 10) is verified through the live UI with Playwright MCP and ends in `Done` or `Todo + Devuelto`.
Local verification is `how-to-test`; prod infra diagnosis is `vendix-cloud-operations`.

## Safety rules (inviolable)

1. Environment is always `https://www.vendix.online` unless the user redirects it.
2. Log in **only** as the demo account. Never a real tenant, customer or staff account, not even read-only.

   | `organization_slug` | `email` | `password` |
   | --- | --- | --- |
   | `vendix` | `vendix.demo@gmail.com` | `vendixDEMO#$%1` |

   If the ticket can only be verified with a non-demo tenant → verdict `Blocked`.
3. Non-destructive: observe first. A write only if the flow requires it, inside the demo org, and
   reversible. Never real payments, messages to real recipients (email/SMS/WhatsApp/push), bulk ops,
   hard deletes, or anything touching another tenant.
4. Never attack prod: no hammering, floods, credential cracking or executable injection payloads.
5. If confirming a weakness could break state, stop at the last safe step and report it.
6. If prod shows another tenant's data: stop reading immediately, report a blocking cross-tenant leak.

## Workflow

1. **Read the ticket** (`linear-issues`) and translate it into the user story:
   "Como <rol> en <entorno>, quiero <funcionalidad> para <resultado>", plus the steps a person follows
   on screen and observable acceptance criteria (what they see). That is the oracle. Record ambiguities.
2. **Pick the demo store** matching the ticket's industry and plan any minimal reversible setup.
   Store roster and switching: `references/demo-stores.md` (read on demand).
3. **Step 0:** open `www.vendix.online`, demo login (staff form, `organization_slug: vendix`), confirm
   you are in the demo org, switch to the target store. Login or page error → `Not deployed / not reachable`.
   Prod has a valid cert: no cert flag.
4. **Happy Path:** follow the story's steps exactly; assert every acceptance criterion.
5. **Sad Path:** the confused-user variants from `how-to-test` (out-of-order, boundary input,
   abandon/resume, stale form). Must fail safely: clear message, no partial write, no false success.
6. **Controlled Probe** (replaces Brute-Force): approach authz/isolation, illegal transitions and money/
   stock invariants up to the last safe observable step. Refused attempt = pass; would-succeed = reported
   risk. Never force the corrupt write.
7. **Verdict + report**, then **suggest** the Linear transition and confirm before applying.

Playwright on prod: same recipe as `how-to-test` (`how-to-test/references/playwright.md`), headed, screenshot
every asserted state (primary evidence), prefer `browser_snapshot` / `browser_network_requests` over writes.

## Verdicts and closing

| Verdict | Meaning | Linear (delegate to `linear-issues`) |
| --- | --- | --- |
| ✅ Matches | Every criterion passes Happy + Sad; Probe found no unreported risk | `Done` |
| ⚠️ Deployed with defects | Present, but a Sad Path fails unsafely, a criterion is partial, or the Probe found a risk | `Todo` + `Devuelto` + priority Alta |
| ❌ Does not match | Prod contradicts or omits the requirement (wrong result, missing flow, regression) | `Todo` + `Devuelto` + priority Alta |
| ⛔ Not deployed / not reachable | Change absent or flow unreachable | No move; stays `In Review`; report to whoever ran the release |
| 🚫 Blocked | Needs a non-demo tenant or a destructive action | No move; report why |

- Priority on `Devuelto`: `priority = current === 1 ? 1 : 2` (never demote Urgent).
- `⛔` never gets `Devuelto`: it is a release gap, not an implementation defect.
- `labelIds` replaces the whole set: read current labels, strip `Aprobado` / `Requiere cambios` /
  `Devuelto`, add `Devuelto`, send the union. Read the issue back (a dead UUID fails silently on the label).
- Never `Done` on a partial run or a green Happy Path alone.
- Post the report as a Linear comment with the transition.

## Report (also the Linear comment)

1. Verdict + one-line justification.
2. Per acceptance criterion: **historia**, **pasos que hizo el agente en pantalla**, **observado vs.
   esperado**, Happy / Sad / Probe result, screenshot.
3. Findings: each defect, disparity or risk with safe repro steps; cross-tenant leaks and would-break
   states marked **blocking**.

| Historia / criterio | Pasos | Esperado | Observado | Happy | Sad | Probe | Evidencia |
| --- | --- | --- | --- | --- | --- | --- | --- |

## Related Skills

`how-to-test` (mechanics, Happy/Sad discipline) · `linear-issues` (read ticket, all writes) ·
`pr-code-review` · `vendix-cloud-operations` · `vendix-multi-tenant-context` / `vendix-prisma-scopes`.
