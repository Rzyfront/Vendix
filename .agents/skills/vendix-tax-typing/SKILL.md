---
name: vendix-tax-typing
description: >
  Typed fiscal tax contract (tax_type) end-to-end: how a tax classification flows
  through calculation, persistence, accounting events, journal lines, declarations,
  DIAN scheme codes, reports, and frontend. Trigger: Adding a new tax_type value
  (INC, IBUA, ICUI, retefuente/reteiva/reteica), wiring a new accounting flow that
  carries tax, adding a fiscal declaration, or debugging a tax that posts to the
  wrong PUC account.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Adding a new tax_type value to the fiscal system"
    - "Wiring withholding (retefuente/reteiva/reteica) accounting or declarations"
    - "Adding a new consumption tax (IBUA, ICUI, INC variant)"
    - "Debugging a tax posting to the wrong PUC account"
    - "Adding a fiscal declaration calculator or DIAN tax scheme code"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Vendix Tax Typing

## Purpose

Governs the **typed fiscal tax contract** (`tax_type`): the rule that every tax in
Vendix carries a fiscal classification that determines its PUC account, its
declaration, and its DIAN scheme code. This skill is the **8-layer checklist** that
prevents the canonical failure mode — typing a tax in one layer but not another, so
it silently falls back to IVA (account `2408`).

Does **not** govern: tax *calculation math* (see `vendix-calculated-pricing`),
journal debit/credit rules (`vendix-accounting-rules`), or the event-driven
mechanics of posting entries (`vendix-auto-entries`). This skill governs only the
*tax-type dimension* threaded through those systems.

## Core Rules

- `tax_type_enum` = `iva | inc | ica | withholding | reteiva | reteica`. Adding a
  value requires its **own** migration (`ALTER TYPE ... ADD VALUE IF NOT EXISTS`),
  separate from any migration that uses it (Postgres restriction).
- **Untyped rows mean IVA.** Every read filter and breakdown builder treats a
  `null`/missing `tax_type` as `'iva'`. Backfill heuristic order:
  reteiva/reteica before withholding; ica/inc before iva; ELSE iva.
- **A tax must be typed in ALL layers or none.** Half-typing is the bug. If the
  calculation emits `tax_type` but the journal line ignores it, INC posts to 2408.
- **`support_document.accepted` DOES post a full accounting entry** — it is not
  excluded from accounting, only from the *typed tax breakdown*. `AutoEntryService
  .onSupportDocumentAccepted()` (`auto-entry.service.ts`) creates a balanced entry
  with expense/purchase debit, accounts payable credit, a `vat_deductible` debit
  line when `tax_amount > 0`, and withholding credit line(s) (typed
  `withholding_breakdown` when present, else the legacy scalar
  `withholding_payable`). What is genuinely excluded is the **multi-type tax
  breakdown** (`tax_breakdown: TaxBreakdownItem[]`): purchases only ever post the
  single scalar `vat_deductible` line — INC is non-deductible, so there is no
  INC-vs-IVA split to make on the purchase side. Do not "fix" this by adding a
  `tax_breakdown` there; withholding, which purchases DO need multi-type, already
  has its own breakdown (`withholding_breakdown`) wired through this same handler.
- Every accounting emit that carries tax MUST pass `tax_breakdown: TaxBreakdownItem[]`
  alongside the scalar `tax_amount`. The scalar is the legacy fallback; the
  breakdown is the typed truth.
- PUC accounts use 4-digit majors, matching the live IVA account (zero regression):
  IVA→`2408`, INC→`2436`, ICA→`2412`.

## The 8-Layer Checklist

A new tax type or a new tax-carrying flow touches **every** layer. Missing one is
the failure mode.

| # | Layer | File | What to do |
| --- | --- | --- | --- |
| 1 | Enum + column | `prisma/schema.prisma` + own migration | `ALTER TYPE tax_type_enum ADD VALUE IF NOT EXISTS`; column on `tax_categories`, `order_item_taxes`, `invoice_taxes` |
| 2 | Calculation | `calculateProductTaxes` | Return `tax_type` per tax row |
| 3 | Persistence | every tax-row create site | Carry `tax_type` (checkout, payments, createFromOrder, manual, credit-notes, quick-create) |
| 4 | Event | accounting emits | Add `tax_breakdown` built via `buildTaxBreakdown(rows)` |
| 5 | Journal line | `auto-entry.service.ts` `resolveTaxLines` | Map key `{prefix}.{tax_type}_{suffix}` + **dual-source** mapping (const + seed) |
| 6 | Declaration | `tax-declaration-draft.service.ts` | Dispatcher route + `calculateX` filtering by `tax_type` |
| 7 | DIAN scheme | `ubl-common.builder.ts` `resolveTaxCodeFromTax` | Map `tax_type` → scheme code (IVA `01`, ICA `03`, INC `04`) |
| 8 | Reports + Frontend | exógena, analytics, `UI_TO_FISCAL_TAX_TYPE` | Filter typed (untyped→iva); UI selector emits fiscal `tax_type` |

## Source of Truth

- `apps/backend/src/common/interfaces/tax-breakdown.interface.ts` — `TaxBreakdownItem`, `buildTaxBreakdown(rows)` (groups by type, fallback iva), `scaleBreakdownToTotal(base, total)` (proportional for partial refunds)
- `apps/backend/src/domains/store/accounting/auto-entries/auto-entry.service.ts` — `resolveTaxLines({prefix, suffix, side, total, breakdown, legacyKey})`
- `apps/backend/src/domains/store/accounting/account-mappings/account-mapping.service.ts` — `DEFAULT_ACCOUNT_MAPPINGS` typed keys
- `apps/backend/prisma/seeds/default-account-mappings.seed.ts` — `MAPPING_DEFAULTS` (must mirror the const)
- `apps/backend/src/domains/fiscal-operations/services/tax-declaration-draft.service.ts` — `calculateVat`, `calculateInc`, dispatcher
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/xml/ubl-common.builder.ts` — `resolveTaxCodeFromTax`, `buildTaxTotals`
- `apps/frontend/src/app/shared/components/forms/default-taxes-form/default-taxes-form.component.ts` — `UI_TO_FISCAL_TAX_TYPE`

## Dual-Source Mapping (the non-obvious one)

`getMapping(org_id, key, store_id)` with a `store_id` present **and no per-store
override** does NOT fall to the org-level DB row — the org-level lookup is guarded
by `!effective_store_id`. It falls straight to `DEFAULT_ACCOUNT_MAPPINGS` (the
const). Therefore a typed mapping key MUST exist in **both**:

1. `DEFAULT_ACCOUNT_MAPPINGS` in `account-mapping.service.ts` (the const).
2. `MAPPING_DEFAULTS` in `default-account-mappings.seed.ts` (the seed).

Mapping only the seed leaves store-scoped sales unable to separate the new tax type
→ it silently posts to the legacy account. Always grep both files together.

## Journal Line Contract

`resolveTaxLines` emits one line per type, key `{prefix}.{tax_type}_{suffix}`
(e.g. `invoice.validated.inc_payable`). If a per-type mapping is null, it falls back
to `legacyKey` (e.g. `invoice.validated.vat_payable`) so **no amount is ever
dropped** and the entry always balances. Balance invariant for a sale:
`AR(debit T) = revenue(S) + iva(i) + inc(n)` where `T = S + i + n`.

Flows wired with the breakdown: `invoice.accepted`, `payment.received` (POS),
`credit_sale.created`, `refund.completed` (refund-flow + return-orders).

## DIAN Header-Level Limitation

`invoice_taxes` is **header-level**, not per-item. A per-line tax-type split is
therefore impossible. The document-level `buildTaxTotals` (which DIAN validates) is
the authoritative source and groups correctly by `tax_type` via
`resolveTaxCodeFromTax`. Do not attempt per-line typing in the UBL builder beyond
the header limitation already documented in the code comment.

## Adding A New Tax Type — Workflow

1. **Enum migration** (own file, `ADD VALUE IF NOT EXISTS`) per `vendix-prisma-migrations`. Regenerate Prisma client in container + host.
2. **Mapping keys** in BOTH `DEFAULT_ACCOUNT_MAPPINGS` and the seed (dual-source). Pick PUC account per `vendix-accounting-rules`.
3. **Calculation** returns the new `tax_type`.
4. **`resolveTaxLines`** auto-handles the new type via the key convention — verify the legacy fallback still balances.
5. **Declaration**: add a `calculateX` + dispatcher route if the tax declares separately; add the obligation enum value (own migration) if it has its own return.
6. **DIAN**: add the scheme code branch in `resolveTaxCodeFromTax`.
7. **Reports + frontend**: extend filters (untyped→iva fallback) and `UI_TO_FISCAL_TAX_TYPE` + UI selector options.
8. **Verify**: backend `tsc -p tsconfig.build.json --noEmit`; confirm enum live in DB; SQL-check the typed mapping materialized per org; create one order with the new tax → validate invoice → inspect the journal line lands on the right PUC.

## Decision Rules

| Situation | Action |
| --- | --- |
| Tax declares on its own return (INC, retentions) | New declaration `calculateX` + dispatcher route + obligation enum value (own migration) |
| Tax is just a new IVA-family rate | No new type; reuse `iva`, only a new `tax_categories` row |
| Purchase/support document tax | Do NOT add breakdown — `vat_deductible` only, INC non-deductible |
| Per-store account override needed | Add row to `accounting_account_mappings`; otherwise dual-source const+seed is enough |
| Reading taxes to aggregate by type | Filter `tax_type`, treat null as `'iva'` |

## Pending Pattern Repetitions (known future work)

- **New consumption taxes** (IBUA bebidas azucaradas, ICUI ultraprocesados, INC
  variants): each walks all 8 layers.
- **`fiscal-obligation.service.ts` role-aware generation**: withholding-return
  obligations are still generated generically; making them conditional on the
  presence of `role='practiced'` rows in the period is a marked `// TODO role-aware`.

## Withholding Chain (role-aware, WIRED)

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
    simple-regime or self-withholder; threshold; applies_to.
  - At most ONE line per `withholding_type` (specificity → highest threshold →
    lowest code). No counterparty / `is_withholding_agent=false` ⇒ `[]`
    (zero-regression default; B2C anonymous sale never suffers).
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

## Related Skills

- `vendix-auto-entries` — event-driven journal posting mechanics (`resolveTaxLines` lives here)
- `vendix-accounting-rules` — debit/credit logic and PUC account selection
- `vendix-fiscal-scope` — NIT ownership and accounting entity resolution
- `vendix-prisma-migrations` — enum ADD VALUE in its own migration
- `vendix-prisma-seed` — seeding the mirrored mapping defaults
- `vendix-calculated-pricing` — the tax calculation math this contract rides on
