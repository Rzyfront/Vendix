---
name: vendix-accounting-rules
description: >
  Colombian accounting rules for auto entries: PUC account selection, debit/credit direction, payroll
  provisions, parafiscales, mapping-key ownership, balanced entries. Trigger: journal entries, mapping
  keys, PUC accounts, debit/credit logic.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke: "Working with journal entries, mapping keys, PUC accounts, payroll provisions, parafiscales, or debit/credit logic"
---

# Vendix Accounting Rules

## Purpose

Use this skill to decide which PUC account is affected and whether the amount is debit or credit. Use `vendix-auto-entries` for the technical event/listener/service workflow.

## Core Rule

Every journal entry must balance:

```text
sum(debit_amount) === sum(credit_amount)
```

Vendix validation tolerates differences up to `0.001`.

## PUC Reference

Account nature by class, common PUC codes used by Vendix and standard entries (invoice, payment, POS, credit sale, expense, purchase, COGS, refund, shrinkage, wallet, cash over/short): `references/puc-accounts.md` (read on demand). Key invariants:

- Class 1/5/6/7 increase with debit; 2/3/4 with credit.
- Employer contributions go to `5105` subaccounts (`510568`…`510578`), never `5110` (Honorarios).
- Labor provisions go to `2510`/`2515`/`2520`/`2525`, never `26xx`.

## Payroll Rules

- **Accrual** is a single entry per run, posted on `payroll.dian_accepted` (no `payroll.approved` event is ever emitted; `'payroll.approved'` survives only as persisted `source_type` and mapping-key prefix). Idempotent by `payroll_runs.accounting_entry_id`, never by `source_type`: debit salary expense `5105`, employer-contribution `5105` subaccounts, and provision `5105` subaccounts; credit net salaries payable `2505`, employee deductions/employer contributions payable `2370`/`2380`, labor withholding `236505`, and labor provision liabilities `2510`/`2515`/`2520`/`2525`.
- **Payment** is cash execution: debit `2505` + `2370` + `2380`, credit bank `1110`. Guard: never post the payment if the accrual did not post (no `accounting_entry_id`) — otherwise you drain liabilities with no expense counterpart.
- Cost centers choose the expense class: `administrative` -> `5105`, `sales` -> `5205`, `operational` -> `7205`.
- **Labor provisions post to class 25xx, NOT 26xx**: cesantías `2510`, intereses `2515`, prima `2520`, vacaciones `2525`. The `26xx` accounts are **obsolete for payroll** (and mislabeled historically — `2610`="Para Obligaciones Laborales", `2615`="Para Obligaciones Fiscales", `2620`="Pensiones de Jubilación", `2625`="Prima de Servicios por Pagar"); the module posts to none of them.
- Employer contributions (health/pension/ARL/SENA/ICBF/CCF) are expensed to `5105` subaccounts (`510568`…`510578`), never to `5110` (Honorarios).
- Incapacity/leave reimbursable-from-EPS is posted to `1355` (semantically-forced use; its real PUC name is "Anticipos de Impuestos y Contribuciones").
- Advance deductions credit `1450` (Anticipos a Empleados). See `vendix-payroll` for the full state machine and `vendix-pila-flatfile` for social-security reporting.

## Mapping Ownership

When defining a mapping key, keep these synchronized:

- `DEFAULT_ACCOUNT_MAPPINGS` in `account-mapping.service.ts`.
- `MAPPING_DEFAULTS` in `default-account-mappings.seed.ts`.
- `MAPPING_LABELS` / `GROUP_DEFINITIONS` in the frontend account mappings component.

Existing sources currently diverge, so always inspect all three before changing mapping logic.

## Validation Checklist

- Debits equal credits.
- Account codes exist in `default-puc.seed.ts` and `chart_of_accounts`.
- Fiscal period is open for `entry_date`.
- No negative debit or credit lines.
- At least one debit and one credit line remain after filtering zero lines.

## Related Skills

- `vendix-auto-entries`
- `vendix-prisma-seed`
- `vendix-prisma-migrations`
