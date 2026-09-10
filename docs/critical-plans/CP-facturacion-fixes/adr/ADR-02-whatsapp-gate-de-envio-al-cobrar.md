---
id: ADR-02
title: "whatsapp-gate-de-envio-al-cobrar"
status: proposed
reversibility: costly
updated: 2026-09-10
---
# ADR-02 — whatsapp-gate-de-envio-al-cobrar

- **Context:** `whatsappCheckout` resolves shipping as optional; physical orders can be born with null
  method/rate and `delivery_type='other'`, while web `checkout()` throws `ORD_SHIP_REQUIRED_001`.
  Human 2026-09-10: creation stays open because the method is chosen later on the order, then charged
  and invoiced.
- **Decision:** Allow creation without shipping; REQUIRE method+rate at charge/invoice time (reuse the
  assign-shipping validation), never at creation.
- **Consequences:** Charge path gains a registered error for missing shipping; dispatch/documents
  downstream always have delivery data for invoiced orders.
- **Reversibility:** costly — orders created under the open rule keep their shape.
- **Revisit if:** assisted sales need charge-without-shipping (pickup handshake cases).
