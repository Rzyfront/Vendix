---
name: vendix-tax-typing
description: >
  Typed fiscal tax contract (tax_type) end-to-end: calculation, accounting events, PUC journal lines, declarations, DIAN scheme codes. Trigger: new tax_type (INC, IBUA, ICUI, retefuente/reteiva/reteica), tax posting to wrong PUC account.
license: MIT
metadata:
  author: rzyfront
  version: "1.3"
  scope: [root]
  auto_invoke:
    - "Adding a new tax_type value to the fiscal system"
    - "Wiring withholding (retefuente/reteiva/reteica) accounting or declarations"
    - "Adding a new consumption tax (IBUA, ICUI, INC variant)"
    - "Debugging a tax posting to the wrong PUC account"
    - "Adding a fiscal declaration calculator or DIAN tax scheme code"
    - "Resolving suffered withholding by operation type (goods vs services)"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Vendix Tax Typing

## Purpose

Governs the **typed fiscal tax contract** (`tax_type`): the rule that every tax in
Vendix carries a fiscal classification that determines its PUC account, its
declaration, and its DIAN scheme code. This skill is the **8-layer checklist** that
prevents the canonical failure mode — typing a tax in one layer but not another, so
it silently falls back to IVA (account `2408`).

Does **not** govern: tax *calculation math* (see `vendix-product-pricing`),
journal debit/credit rules (`vendix-accounting-rules`), or the event-driven
mechanics of posting entries (`vendix-auto-entries`). This skill governs only the
*tax-type dimension* threaded through those systems.

## Core Rules

- `tax_type_enum` = `iva | inc | ica | withholding | reteiva | reteica | icui | ibua` (`icui`/`ibua` today only in the purchase tax kernel `common/money-kernel/purchase-line-taxes.ts`; not wired through the 8 sales layers). Adding a
  value requires its **own** migration (`ALTER TYPE ... ADD VALUE IF NOT EXISTS`),
  separate from any migration that uses it (Postgres restriction).
- **Untyped rows mean IVA.** Every read filter and breakdown builder treats a
  `null`/missing `tax_type` as `'iva'`. Backfill heuristic order:
  reteiva/reteica before withholding; ica/inc before iva; ELSE iva.
- **Resolve the default at the SOURCE ROW, never at the write point.** A `?? 'iva'` beside a `prisma.create` turns «typed INC but not propagated» into IVA (real case: `calculateTaxCategoryTaxes` omitted `tax_type`, `buildOrderItemSnapshot` filled `?? 'iva'`, DIAN accepted a non-existent «8 % IVA»; found in 5 places). Make `tax_type` **required** in the resolver's return type and let an unresolvable category throw.
- **A tax must be typed in ALL layers or none.** Half-typing is the bug. If the
  calculation emits `tax_type` but the journal line ignores it, INC posts to 2408.
- **`support_document.accepted` DOES post a full entry** (`onSupportDocumentAccepted`: expense debit, AP credit, scalar `vat_deductible` debit, withholding credits via `withholding_breakdown` or legacy `withholding_payable`). Only the multi-type `tax_breakdown` is excluded on purchases (INC is non-deductible). Do not add `tax_breakdown` there.
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
| 3 | Persistence | every tax-row create site | Carry `tax_type` (checkout, payments, createFromOrder, manual, credit-notes, quick-create). **No `??` at the create site** — the resolver must return it required |
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

## Adding A New Tax Type

Step-by-step workflow (enum migration, mappings, calculation, journal, declaration, DIAN, reports, verification): `references/new-tax-type-workflow.md`.

## Decision Rules

| Situation | Action |
| --- | --- |
| Tax declares on its own return (INC, retentions) | New declaration `calculateX` + dispatcher route + obligation enum value (own migration) |
| Tax is just a new IVA-family rate | No new type; reuse `iva`, only a new `tax_categories` row |
| Purchase/support document tax | Do NOT add breakdown — `vat_deductible` only, INC non-deductible |
| Per-store account override needed | Add row to `accounting_account_mappings`; otherwise dual-source const+seed is enough |
| Reading taxes to aggregate by type | Filter `tax_type`, treat null as `'iva'` |

## Pending

- ICUI/IBUA (and new INC variants) on the sales side: each must walk all 8 layers; today they exist only in the enum and purchase kernel.

## Withholding Chain (summary)

Full rules, gates and known gaps: `references/withholding-chain.md` (read on demand). Invariants:

- Extra axis `withholding_role_enum` = `practiced` (tenant withholds a supplier → liability credit, `2365xx`/`2367xx`/`2368xx`) | `suffered` (agent customer withholds the tenant → asset debit `1355xx`). Mapping keys `withholding.{role}.{type}_{payable|receivable}`, dual-source.
- Applicability only via the pure `WithholdingResolverService.evaluate()`; at most one line per `withholding_type`; no counterparty / not an agent ⇒ `[]`.
- `suffered` ALWAYS through `WithholdingFlowService.resolveSufferedByOperation(items)`: goods and services split into separate groups with their own base/IVA/threshold (owner 2026-09-26), resolved sequentially (interactive `tx`). Never call `resolveSuffered` without `appliesTo`. In `suffered`, `supplier_type_filter !== 'any'` concepts are discarded.
- reteIVA base = IVA amount; retefuente/reteICA = subtotal; UVT threshold always on subtotal.
- UI uses `POST /api/store/withholding-tax/preview`; never re-implement the legal logic.
- Reports: form 350 and exógena 1001 = `practiced`; exógena 1003 = `suffered` (credit in favor, never in `balance_due`). Withholding obligations are generated only when `practiced` rows exist in the period (`fiscal-obligation.service.ts`).

## Related Skills

- `vendix-auto-entries` — event-driven journal posting mechanics (`resolveTaxLines` lives here)
- `vendix-accounting-rules` — debit/credit logic and PUC account selection
- `vendix-dian-issuer-identity` — the *issuer's* fiscal identity (IVA/INC responsibility, PartyTaxScheme, printable calidades); this skill types the *tax*, that one types the *merchant*
- `vendix-fiscal-scope` — NIT ownership and accounting entity resolution
- `vendix-prisma-migrations` — enum ADD VALUE in its own migration
- `vendix-prisma-seed` — seeding the mirrored mapping defaults
- `vendix-product-pricing` — the tax calculation math this contract rides on
