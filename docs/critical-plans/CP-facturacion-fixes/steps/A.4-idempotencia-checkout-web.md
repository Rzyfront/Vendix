---
id: A.4
title: "idempotencia-checkout-web"
phase: A
status: done
owner: none
updated: 2026-09-10
contracts: [FB-03, DB-04]
adrs: []
skills: [vendix-backend-api, vendix-validation, vendix-prisma-scopes, how-to-test]
---
# A.4 — idempotencia-checkout-web

- **Skills:** vendix-backend-api, vendix-validation, vendix-prisma-scopes, how-to-test
- **Resources:** `checkout.service.ts:checkout`, `whatsappCheckout`, orders table, frontend checkout submit
- **Business decision:** Double submit must never create two orders/invoices; second hit returns the first result within a 24h window.
- **Why:** No `Idempotency-Key` today; duplicates compound F-001 (two orders, two drafts, two numbers).
- **Output:** `Idempotency-Key` header accepted on web checkout(s); keyed by (store, cart/user, address-hash); replay returns original response; no new order/invoice/draft.
- **Contracts touched:** FB-03 (checkout request contract + header), DB-04 (idempotency record lifecycle + TTL).
- **Data impact:** new idempotency store (table with TTL or cache); no changes to existing orders/invoices.
- **Blast radius:** checkout creation; a wrong key scope blocks legitimate distinct purchases — scope narrowly, expire fast.
- **Rollback:** ignore-header fallback (previous behavior); stored keys expire on their own.
- **Verification:**
  - `curl` same key twice → one order, one invoice draft; different carts → two orders
  - parallel double-POST probe → exactly one order (evidence/)
- **Acceptance checklist:**
  - [x] F-003 — checkout-web-sin-idempotencia (minor)
  - [ ] replay returns first result; concurrent duplicates impossible
- **Status:** done
