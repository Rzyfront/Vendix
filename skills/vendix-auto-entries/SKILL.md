---
name: vendix-auto-entries
description: >
  Automatic journal entries: event-driven accounting, AutoEntryService, AccountingEventsListener,
  account mapping cascade, mapping-key sync. Trigger: adding automatic accounting flows, auto-entry
  logic, mapping keys, missing journal entries.
license: MIT
metadata:
  author: rzyfront
  version: "2.2"
  scope: [root]
  auto_invoke:
    - "Splitting withholding across multi-tender payment legs"
    - "Adding new automatic journal entries"
    - "Debugging missing accounting entries"
    - "Adding new mapping keys to accounting"
    - "Modifying auto-entry event handlers"
    - "Working with AccountingEventsListener or AutoEntryService"
---

# Vendix Auto Entries

## Source of Truth

- `apps/backend/src/domains/store/accounting/auto-entries/auto-entry.service.ts`
- `apps/backend/src/domains/store/accounting/auto-entries/accounting-events.listener.ts`
- `apps/backend/src/domains/store/accounting/account-mappings/account-mapping.service.ts`
- `apps/backend/prisma/seeds/default-account-mappings.seed.ts`
- `apps/frontend/src/app/private/modules/store/accounting/components/account-mappings/account-mappings.component.ts`

## Flow

Domain service emits an EventEmitter2 event after business success. `AccountingEventsListener` catches the event, normalizes amounts with `Number()`, and calls `AutoEntryService`. `AutoEntryService` resolves mapping keys, validates balance/account/fiscal period, then creates posted accounting entries.

Accounting failures are logged in listeners and must not roll back the already-completed business transaction.

## Mapping Resolution

`AccountMappingService.getMapping(org_id, mapping_key, store_id?)` resolves:

1. Store override in `accounting_account_mappings`.
2. Organization base mapping.
3. `DEFAULT_ACCOUNT_MAPPINGS` fallback in code.

Mapping key convention: `{event}.{account_role}`. Cost-center variants use `{event}.{role}.{cost_center}`.

## Listener Events

Source of truth (the list grows often): `grep -n "@OnEvent(" apps/backend/src/domains/store/accounting/auto-entries/accounting-events.listener.ts`. Non-obvious cases:

- `invoice.accepted` → `handleInvoiceAccepted` → `AutoEntryService.onInvoiceValidated()`; the persisted `source_type` is still `'invoice.validated'` (event name and `source_type` differ on purpose). Credit notes arrive on the same event (`invoice_type === 'credit_note'`) and branch to `onCreditNoteAccepted` (reversal, never extra revenue).
- `intercompany_transfer.shipped|received` are not events: they are generated inside `stock_transfer.completed` (see Intercompany below).
- `dispatch_route.closed` posts only the driver cash variance.
- No `payroll.approved` event is emitted: payroll accrual enters via `payroll.dian_accepted` and payment via `payroll.paid`; `'payroll.approved'` remains only as `source_type`/mapping-key prefix.
- Every handler checks the fiscal gate (`isFlowEnabled(store_id, <subflow>)`); an inactive fiscal area silently skips the entry by design.

## createAutoEntry Rules

- Null/zero-only lines are filtered.
- Fewer than two valid lines are skipped.
- Debits and credits must balance within `0.001`.
- An open fiscal period must cover `entry_date`.
- Every account code must exist in `chart_of_accounts` for the organization.
- Entries are created posted immediately.
- Entry number format is `AE-{YEAR}-{000001}` per organization/year.

## Idempotency Rule (source_type + source_id)

`createAutoEntry` guards duplicates with an **application-level** `findFirst` on
`(organization_id, source_type, source_id, accounting_entity_id)` before creating
the entry — if a match exists it logs a warning and returns the existing entry
instead of creating a duplicate. There is **no unique DB constraint** backing
this; it is a race-susceptible pre-check, not true idempotency at the storage
layer. Keep `source_id` unique per real business event when wiring a new flow:

- **Purchase order receptions are the special case.** A purchase order can be
  received in multiple partial batches. Using `purchase_order_id` as `source_id`
  would make `createAutoEntry` treat the 2nd/3rd partial reception as a duplicate
  of the 1st and silently skip posting it. `onPurchaseOrderReceived()` therefore
  uses `purchase_order_receptions.id` (`reception_id`) as `source_id` instead —
  each partial reception is a distinct accounting event with its own prorated
  `total_amount` (computed by the emitter in `purchase-orders.service.ts`, never
  recomputed in the handler).
- When adding a new flow that can fire more than once per parent record (partial
  fulfillment, partial payment, retries), identify the correct atomic child id to
  use as `source_id` — do not default to the parent id.

## Withholding On Multi-Tender Payments (N `payment.received` per sale)

A customer that is a withholding agent (retención sufrida) is recognized ONCE
per order. A multi-tender POS payment emits one `payment.received` per leg, so
each leg's `withholding_breakdown` carries only its prorated share:

- Pure `splitWithholdingLines(lines, legAmounts)` in
  `apps/backend/src/domains/store/payments/utils/payment-sale-share.util.ts`
  splits each line by leg amount in integer cents, residue on the LAST leg
  (same criterion as `sale_share` / `resolvePaymentReceivedSaleFields`), so
  Σ portions = original line to the cent. `legAmounts.length <= 1` returns the
  original lines untouched (historical payload).
- Used in `payments.service.ts` in the per-leg emission loop
  (`withholdingByLeg[legIndex]`).
- Why: all withholding on one leg unbalances that entry (every
  `payment.received` must balance on its own); repeating it on every leg posts
  it N times.
- Anti-pattern: `withholding_breakdown: wh.lines` inside the per-leg loop.
  (`credit_sale.created` is a single event and keeps `wh.lines`.)
- QUI-576 (reported imbalance equal to the withholding in the no-invoice
  branch of `onPaymentReceived`, rows in `accounting_entry_failures`): the
  code now documents "cash stays net-received, debits (cash + 1355) =
  credits"; confirm in `accounting_entry_failures` before assuming it is
  open. Never "fix" it by changing the proration.

## Third-Party Snapshot (summary)

`accounting_entry_lines.third_party_*` is a historical snapshot attached by the EMITTER on each `AutoEntryLine` (`AutoEntryThirdParty`); never add a lookup inside `AutoEntryService`. Detail: `references/third-party-and-intercompany.md`.

## Adding A New Auto Entry Flow

1. Define debit/credit behavior using `vendix-accounting-rules`.
2. Add mapping keys to `DEFAULT_ACCOUNT_MAPPINGS` in `account-mapping.service.ts`.
3. Add the same keys to `MAPPING_DEFAULTS` in `default-account-mappings.seed.ts`.
4. Add frontend labels/groups in `account-mappings.component.ts`.
5. Add an `AutoEntryService.onXxx()` handler and ensure lines balance.
6. Add or reuse a valid `accounting_entry_type_enum` mapping in `createAutoEntry()`.
7. Add an `@OnEvent()` listener with try/catch and numeric normalization.
8. Emit the event after the main transaction succeeds.
9. Run the seed in the target environment so org mappings exist.

## Intercompany Stock Transfers (summary)

With `operating_scope=ORGANIZATION` + `fiscal_scope=STORE` and different stores, `onStockTransferCompleted()` creates two posted entries (source and destination entity) linked via `intercompany_transactions`, using keys `intercompany_transfer.shipped.{receivable,inventory}` / `intercompany_transfer.received.{inventory,payable}` (defaults 1365/1435/1435/2355); otherwise normal stock-transfer entry. Log skips. Detail: `references/third-party-and-intercompany.md`.

## Current Risk To Know

`DEFAULT_ACCOUNT_MAPPINGS`, `default-account-mappings.seed.ts`, and frontend labels are not fully aligned. When adding or debugging mappings, check all three files. Some SaaS and wallet/AP/AR keys exist in one source but not another.

## Debug Checklist

- Backend logs contain `Failed to create auto-entry`.
- Event name matches listener exactly.
- `organization_id` is present and a fiscal period is open.
- Mapping key resolves for org/store.
- PUC account exists in `chart_of_accounts`.
- `(organization_id, source_type, source_id, accounting_entity_id)` has an application-level duplicate guard (see Idempotency Rule above) but no DB unique constraint — do not assume it is race-safe under concurrent retries, and always pick the correct atomic `source_id` (see the `reception_id` case) so legitimate repeat events are not skipped as false duplicates.

## Related Skills

- `vendix-accounting-rules`
- `vendix-prisma-migrations`
- `vendix-prisma-seed`
- `vendix-backend`
