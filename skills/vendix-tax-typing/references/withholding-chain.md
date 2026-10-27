# Withholding chain (role-aware)

Withholding (`retefuente`/`reteiva`/`reteica`) is now wired end-to-end, but it adds
an axis the 8-layer `tax_type` model does **not** have: the **role**. The same
`withholding_type` posts to a different PUC depending on who withholds whom.

- **Two enums.** `withholding_type_enum` = `retefuente | reteiva | reteica`.
  `withholding_role_enum` = `practiced | suffered`.
  - `practiced` (CASO 1): the tenant buys and withholds a SUPPLIER → **liability,
    credit**. PUC `2365xx` (retefuente) / `2367xx` (reteIVA) / `2368xx` (reteICA).
  - `suffered` (CASO 2): the tenant sells and a withholding-agent CUSTOMER
    withholds the tenant → **asset (anticipo), debit**. PUC `1355xx`.
- **Mapping key shape differs.** Not `{prefix}.{tax_type}_{suffix}` but
  `withholding.{role}.{type}_{payable|receivable}` (e.g.
  `withholding.practiced.retefuente_payable` → 236525,
  `withholding.suffered.retefuente_receivable` → 135510). Dual-source as always
  (const in `account-mapping.service.ts` + `default-account-mappings.seed.ts`).
- **Determinism is the contract — never arbitrary.** Applicability is decided by a
  PURE resolver (`WithholdingResolverService.evaluate()`), unit-tested, on the
  fiscal classification of BOTH parties + concept + UVT threshold. Gates:
  - practiced: tenant.`is_withholding_agent` true; skip retefuente if supplier
    `is_self_withholder` or `regimen_simple`; `base ≥ min_uvt × uvt`;
    `supplier_type_filter` matches.
  - suffered: customer.`is_withholding_agent` true; skip retefuente if tenant is
    simple-regime or self-withholder; threshold; applies_to; **and**
    `supplier_type_filter !== 'any'` is discarded outright, never compared — the
    retained party in `suffered` is the TENANT, not a supplier, so a concept like
    `RTE_HONOR_PN` (`supplier_type_filter: 'persona_natural'`) classifies nobody
    real. Before this gate the same condition still fed `specificity: 1`, so
    `RTE_HONOR_PN` (10%) always outranked the any-filter `RTE_COMPRAS`/
    `RTE_SERV_GEN` (`specificity: 0`) regardless of what was actually sold — every
    sale to a withholding-agent customer came out `RTE_HONOR_PN`.
  - At most ONE line per `withholding_type` (specificity → highest threshold →
    lowest code). No counterparty / `is_withholding_agent=false` ⇒ `[]`
    (zero-regression default; B2C anonymous sale never suffers). Data note: the
    seed's `RTE_SERV_DEC` and `RTE_SERV_GEN` are identical on every gate (both
    `applies_to: 'service'`, `supplier_type_filter: 'any'`, threshold 4 UVT, rate
    4%), so the code tiebreak always resolves to `RTE_SERV_DEC` (`'D' < 'G'`
    lexicographically). Harmless today only because their rate matches — a future
    service concept with a different rate must not rely on this tiebreak.
- **`suffered` is ALWAYS resolved by operation type — never call `resolveSuffered`
  directly.** Every caller goes through
  `WithholdingFlowService.resolveSufferedByOperation(items)`
  (`withholding-flow.service.ts`): POS (`payments.service.ts`),
  `invoicing.service.ts`, `invoice-flow.service.ts`, the preview
  (`withholding-tax.service.ts`, whose `PreviewWithholdingDto` takes an optional
  `product_type` defaulting to goods), and `order-flow.service.ts`
  `payOrder`/`confirmPayment` (wired in `fbcca71a0`, on top of this fix). It groups
  the sale's line items by operation — `product_type === 'service'` →
  `appliesTo: 'service'`; `physical`, `prepared`, `custom`, no product, or no
  determinable type → `appliesTo: 'purchase'` (owner decision, 2026-09-26: goods
  and services are ALWAYS split, never averaged or picked by dominant type) — and
  resolves each group with its OWN summed base, IVA, and UVT threshold: a mixed
  sale of goods + services yields one withholding line per group, not one line for
  the whole ticket. Resolution across groups is sequential, not `Promise.all` —
  `client` is typically an interactive Prisma `tx`, which does not support
  concurrent queries on the same connection.
  - **Anti-pattern:** calling `resolveSuffered` without `appliesTo`. That is
    exactly the bug this fixed: `WithholdingResolverService.evaluate()` saw every
    concept unfiltered by `applies_to`, leaving the `supplier_type_filter` discard
    above as the only gate between a services sale and `RTE_HONOR_PN`.
  - **Knowledge gap:** there is no reliable tenant counterparty-type field today,
    so the `supplier_type_filter` gate in `suffered` is a blanket discard, not a
    real comparison. If a tenant fiscal profile is ever modeled (e.g. a natural
    person providing honorarios), replace the discard with a genuine comparison —
    see the code comment at that gate in `withholding-resolver.service.ts`.
- **reteIVA base ≠ subtotal.** reteIVA is computed on the IVA amount of the
  operation (`ivaAmount`), not the subtotal; retefuente/reteICA use the subtotal.
  The UVT threshold gate always uses the subtotal. Pass both `base` and `ivaAmount`.
- **Flow adapter + preview.** `WithholdingFlowService` (`resolvePracticed` /
  `resolveSuffered` / `persistWithholdingLines`) reads tenant fiscal_data
  (parameterized prisma read, NOT `getFiscalData()` which throws without store
  context) + counterparty, calls the resolver, persists `withholding_calculations`
  (with `role`, `withholding_type`, `customer_id`/`supplier_id`,
  `counterparty_type`). Flow services attach `withholding_breakdown:
  WithholdingLine[]` to the emit; the listener/`auto-entry` reduces AR/AP by the
  total and posts the offsetting per-type lines. `POST
  /api/store/withholding-tax/preview` exposes the resolver to POS/POP carts so the
  UI never re-implements the legal logic.
- **Reports are role-split.** Declaration (form 350) and exógena **1001** =
  `role:'practiced'` (third party = supplier). Exógena **1003** =
  `role:'suffered'` (third party = the agent CUSTOMER, NIT from
  `users.document_number`). Suffered rows are a credit-to-favor, never part of the
  declaration's `balance_due`.

Withholding source of truth:
`apps/backend/src/domains/store/withholding-tax/withholding-resolver.service.ts`,
`withholding-flow.service.ts`, `withholding-classification.util.ts`;
`apps/backend/src/common/interfaces/withholding-breakdown.interface.ts`.
