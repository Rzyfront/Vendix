---
id: ADR-03
title: "web-autoenvio-al-confirmar-pago"
status: proposed
reversibility: costly
updated: 2026-09-10
---
# ADR-03 — web-autoenvio-al-confirmar-pago

- **Context:** Web invoice drafts wait for manual panel send (or data-request completion); POS has
  `auto_emit`. Webhook-approved payments leave drafts sitting. Decided with the human 2026-09-10.
- **Decision:** On payment confirmation (webhook approved), best-effort auto-send the order invoice via
  invoice-flow `send`, never blocking payment. Manual send stays as fallback. Failures surface on the
  order flag (F-004) instead of logs only.
- **Consequences:** Webhook handler gains a non-blocking emission call; retry queue absorbs transients;
  `send()` state machine already makes this idempotent.
- **Reversibility:** costly — once DIAN accepts, the document is immutable (credit-note path only).
- **Revisit if:** a store wants review-before-send (per-store opt-out flag, default on).
