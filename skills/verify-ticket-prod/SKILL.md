---
name: verify-ticket-prod
description: >
  Non-destructive production E2E verification (Playwright, www.vendix.online, demo account only) that a Linear ticket meets its user story, then Done or Devuelto. Trigger: /verify-ticket-prod.
disable-model-invocation: true
license: MIT
metadata:
  author: rzyfront
  version: "2.3"
  scope: [root]
  auto_invoke:
    - "Verifying a Linear ticket is correctly applied in production"
    - "Closing a Linear ticket to Done after QA verifies it in production"
    - "Returning a failed ticket to Todo with the Devuelto label and raised priority"
    - "Running a controlled E2E verification of a shipped ticket on www.vendix.online"
    - "Confirming a production fix matches its requirement or reporting defects"
    - "Non-destructive production verification with the demo account"
    - "Configuring a demo store or module in production with semi-real data"
    - "Packaging per-story step screenshots and the report as a QA evidence folder"
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
   | `vendix-demo` | `vendix.demo@gmail.com` | `vendixDEMO#$%1` |

   If the ticket can only be verified with a non-demo tenant → verdict `Blocked`.
3. Non-destructive: observe first. A write only if the flow requires it, inside the demo org, and
   reversible. Never real payments, messages to real recipients (email/SMS/WhatsApp/push), bulk ops,
   hard deletes, or anything touching another tenant.
4. Never attack prod: no hammering, floods, credential cracking or executable injection payloads.
5. If confirming a weakness could break state, stop at the last safe step and report it.
6. If prod shows another tenant's data: stop reading immediately, report a blocking cross-tenant leak.

## Demo data (semi-real)

The demo stores are shown to prospects as "this is how your business would look". Every record the
agent creates or edits while testing a flow or configuring a module (products, customers, rooms,
stations, providers, tables, templates, page texts, notes) must look like a real, working business:

- **Realistic and coherent:** Colombian Spanish names with accents (`Valeria Suárez Molina`), products
  with a description, unit and COP price that fit the store's niche, and texts consistent with the
  store settings (hours, policies, address).
- **Generic, never branded:** no real trademarks, companies or people (`Cerveza lager 330 ml`, not a
  real brand), so any prospect can picture their own business.
- **No test markers in visible fields:** no `test`, `prueba`, `demo`, `QA`, `asdf`, `Cliente 1`,
  lorem ipsum or ticket IDs. Traceability goes in internal notes or in the report, never in names.
- **Contact data reaches nobody:** emails on the demo inbox alias (`vendix.demo+<alias>@gmail.com`),
  no real person's phone or ID, and no messages sent (Safety rule 3).
- **Close clean:** before the report, rename or archive (reversibly) any record that breaks these
  rules, including the ones a Sad Path or Probe left visible.

## Workflow

1. **Read the ticket** (`linear-issues`) and translate it into the user story:
   "Como <rol> en <entorno>, quiero <funcionalidad> para <resultado>", plus the steps a person follows
   on screen and observable acceptance criteria (what they see). That is the oracle. Record ambiguities.
2. **Pick the demo store** matching the ticket's industry and plan any minimal reversible setup with
   semi-real data (see Demo data).
   Store roster and switching: `references/demo-stores.md` (read on demand).
3. **Step 0:** open `https://vendix.online/auth/login`, demo login ("Seleccionar comercio" →
   "Organización" → `vendix-demo`), confirm the org panel of "Demo Vendix", switch to the target
   store (recipe and known UI bugs in `references/demo-stores.md`). Login or page error →
   `Not deployed / not reachable`.
   Prod has a valid cert: no cert flag.
4. **Happy Path:** follow the story's steps exactly; assert every acceptance criterion.
5. **Sad Path:** the confused-user variants from `how-to-test` (out-of-order, boundary input,
   abandon/resume, stale form). Must fail safely: clear message, no partial write, no false success.
6. **Controlled Probe** (replaces Brute-Force): approach authz/isolation, illegal transitions and money/
   stock invariants up to the last safe observable step. Refused attempt = pass; would-succeed = reported
   risk. Never force the corrupt write.
7. **Verdict + report**, then **suggest** the Linear transition and confirm before applying.
8. **Evidence package:** leave the run in the folder described below and return its path, so a
   person or another agent can review or forward it without re-running the flow.

Playwright on prod: same recipe as `how-to-test` (`how-to-test/references/playwright.md`), headed, screenshot
every asserted state (primary evidence), prefer `browser_snapshot` / `browser_network_requests` over writes.

## Evidence package

Every run ends in one folder, the same whoever runs it (QA, agent, CI), so a reviewer reads each
story in order with its screenshots. `.qa-evidence/` is gitignored: never commit it.

```
.qa-evidence/<TICKET-ID>/
├── report.md                       # the Report below, screenshots linked by relative path
├── manifest.json                   # machine-readable index (schema below)
├── 01-<story-slug>/
│   ├── 01-<step-slug>.png           # Happy Path, one PNG per step, in execution order
│   ├── 02-<step-slug>.png
│   └── sad-01-<variant-slug>.png    # Sad Path / probe-NN-* for the Controlled Probe
└── 02-<story-slug>/…
```

- **One folder per user story / acceptance criterion**, numbered in the order of the report.
- **One screenshot per step**, taken right after the step's assertion, named `NN-<what is seen>`
  in kebab-case Spanish (`03-carrito-con-total-actualizado.png`); never a generic `screenshot-1.png`.
  Pass the full path to `browser_take_screenshot({ filename })`, so nothing is left in `.playwright-mcp/`.
- **Failures get their own shot:** the screen where a criterion fails or a defect shows, named
  `NN-falla-<what>.png`, and linked from the finding.
- **No sensitive data in frame:** credentials, tokens or another tenant's data never appear in a
  screenshot; if one slipped in, delete it and retake.
- `manifest.json`, so tools can render or forward the package without parsing Markdown:

  ```json
  {
    "ticket": "QUI-123",
    "verdict": "matches | defects | does_not_match | not_deployed | blocked",
    "summary": "one line",
    "stories": [
      {
        "id": "01-<story-slug>",
        "story": "Como <rol>, quiero <funcionalidad> para <resultado>",
        "result": "pass | fail | partial | blocked",
        "steps": [
          { "n": 1, "action": "lo que hizo en pantalla", "expected": "…", "observed": "…",
            "result": "pass | fail", "path": "happy | sad | probe", "screenshot": "01-<story-slug>/01-<step-slug>.png" }
        ]
      }
    ],
    "findings": [ { "severity": "blocking | high | medium | low", "text": "…", "screenshot": "…" } ]
  }
  ```
- Close with the absolute path of the folder in the final message; the Linear comment attaches the
  failure screenshots (and the key Happy Path ones), not the whole folder.

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
