---
id: A.3
title: "autoenvio-web-y-superficie-de-fallos"
phase: A
status: done
owner: none
updated: 2026-09-10
contracts: [FB-02, DB-03, ERR-03]
adrs: [ADR-03]
skills: [vendix-backend-api, vendix-error-handling, vendix-prisma-scopes, how-to-test]
---
# A.3 — autoenvio-web-y-superficie-de-fallos

- **Skills:** vendix-backend-api, vendix-error-handling, vendix-prisma-scopes, how-to-test
- **Resources:** webhook handler (Wompi approve), `invoice-flow.service.ts:send`, `invoice-data-requests.service.ts:sendBestEffort`, POS fiscal-status endpoint (parity model)
- **Business decision:** ADR-03: webhook-approved payment best-effort auto-sends the web invoice; manual send stays; failures land on an order flag, never logs-only.
- **Why:** Web drafts sit until manual send (open question confirmed); silent warn-only failure (F-004) hides paid-without-invoice orders until tax season.
- **Output:** Non-blocking emission call on payment confirmation; `order.invoice_fiscal_flag` (or equivalent) + panel surfacing; retry queue absorbs transients.
- **Contracts touched:** FB-02 (webhook→send), DB-03 (order fiscal flag), ERR-03 (emission failure code).
- **Data impact:** additive flag column via versioned migration; existing orders default neutral; no backfill of old failures.
- **Blast radius:** webhook path (payments!) — emission must never throw into payment confirmation; DIAN accepts are immutable.
- **Rollback:** kill-switch setting (per-store opt-out, default on); already-accepted documents stand (credit-note path only).
- **Verification:**
  - sandbox webhook approve → draft auto-sends; DIAN down → payment ok + flag set + retry enqueued (evidence/)
  - `send()` double-fire stays single transmission (state machine)
- **Acceptance checklist:**
  - [x] F-004 — fallo-factura-silencioso-en-web (minor)
  - [ ] approved payment auto-sends; failure visible on order/panel, payment never blocked
- **Status:** done
