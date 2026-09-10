---
id: A.2
title: "gate-envio-whatsapp-al-cobro"
phase: A
status: done
owner: none
updated: 2026-09-10
contracts: [FB-01, ERR-02]
adrs: [ADR-02]
skills: [vendix-backend-api, vendix-validation, vendix-error-handling, how-to-test]
---
# A.2 — gate-envio-whatsapp-al-cobro

- **Skills:** vendix-backend-api, vendix-validation, vendix-error-handling, how-to-test
- **Resources:** `checkout.service.ts:whatsappCheckout`, assign-shipping validation (`order-flow.service.ts:1320`), `ORD_SHIP_REQUIRED_001`
- **Business decision:** ADR-02: creation stays open; charge/invoice of physical orders requires method+rate.
- **Why:** WhatsApp orders are born shippyless by design (method chosen later on the order); the hole is charging/invoicing without it (F-002).
- **Output:** Charge path throws a registered error when physical items lack method+rate; creation unchanged.
- **Contracts touched:** FB-01 (whatsapp charge contract), ERR-02 (new missing-shipping-at-charge code).
- **Data impact:** none — validation only, no rows rewritten.
- **Blast radius:** assisted/WhatsApp sales; a wrong gate blocks real charges — error message must name the missing step.
- **Rollback:** revert the guard commit; already-created orders unaffected.
- **Verification:**
  - `curl` whatsapp charge without shipping → registered code + 4xx, no state change
  - `curl` whatsapp charge with method+rate → proceeds; backend jest green
- **Acceptance checklist:**
  - [x] F-002 — whatsapp-sin-gate-de-envio (major)
  - [ ] creation without shipping still allowed; charge without it blocked with named error
- **Status:** done
