---
name: vendix-auto-entries
description: >
  Automatic journal entry system: event-driven accounting, AutoEntryService,
  AccountingEventsListener, account mapping cascade, and mapping-key sync. Trigger:
  When adding automatic accounting flows, modifying auto-entry logic, adding mapping keys,
  or debugging missing journal entries.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke:
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

## Current Listener Events

- `invoice.validated`
- `payment.received`
- `credit_sale.created`
- `expense.approved`
- `expense.paid`
- `payroll.approved`
- `payroll.paid`
- `order.completed`
- `refund.completed`
- `purchase_order.received`
- `purchase_order.payment`
- `inventory.adjusted`
- `layaway.payment_received`
- `layaway.completed`
- `installment_payment.received`
- `settlement.paid`
- `depreciation.posted`
- `disposal.fixed_asset`
- `withholding.applied`
- `stock_transfer.completed`
- `cash_register.opened`
- `cash_register.closed`
- `cash_register.movement`
- `ar.written_off`
- `ap.payment_registered`
- `ap.written_off`
- `commission.calculated`
- `wallet.credited`
- `wallet.debited`
- `expense.refunded`
- `expense.cancelled`
- `accounting.saas_subscription_payment.succeeded`

## createAutoEntry Rules

- Null/zero-only lines are filtered.
- Fewer than two valid lines are skipped.
- Debits and credits must balance within `0.001`.
- An open fiscal period must cover `entry_date`.
- Every account code must exist in `chart_of_accounts` for the organization.
- Entries are created posted immediately.
- Entry number format is `AE-{YEAR}-{000001}` per organization/year.

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

## Current Risk To Know

`DEFAULT_ACCOUNT_MAPPINGS`, `default-account-mappings.seed.ts`, and frontend labels are not fully aligned. When adding or debugging mappings, check all three files. Some SaaS and wallet/AP/AR keys exist in one source but not another.

## Debug Checklist

- Backend logs contain `Failed to create auto-entry`.
- Event name matches listener exactly.
- `organization_id` is present and a fiscal period is open.
- Mapping key resolves for org/store.
- PUC account exists in `chart_of_accounts`.
- Source uniqueness is not enforced by schema; do not assume automatic idempotency from `(source_type, source_id)`.

## Related Skills

- `vendix-accounting-rules`
- `vendix-prisma-migrations`
- `vendix-prisma-seed`
- `vendix-backend`
