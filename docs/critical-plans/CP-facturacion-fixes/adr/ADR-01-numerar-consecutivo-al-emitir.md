---
id: ADR-01
title: "numerar-consecutivo-al-emitir"
status: proposed
reversibility: costly
updated: 2026-09-10
---
# ADR-01 — numerar-consecutivo-al-emitir

- **Context:** `createFromOrder` calls `generateNextNumber` at draft creation, so every web checkout
  (including unpaid/abandoned `pending_payment` orders) consumes a DIAN resolution consecutive. Ranges are
  finite; abandoned drafts leave unjustified gaps. Decided with the human 2026-09-10.
- **Decision:** Assign the consecutive at validate/send time, never at draft creation. Drafts without
  numbers for unpaid orders. Already-numbered drafts are grandfathered (never rewritten).
- **Consequences:** Touches the number generator, `createFromOrder`, POS `emitForOrder` (eligibility →
  create → validate → send stays valid), and re-emit (`rejected → sent` keeps its number).
- **Reversibility:** costly — numbering order affects gaps permanently once emitted.
- **Revisit if:** DIAN requires number-at-issue for the acquirer-facing draft (rejected today).
