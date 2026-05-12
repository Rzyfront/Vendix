---
name: vendix-accounting-rules
description: >
  Colombian accounting rules for Vendix automatic entries: PUC account selection,
  debit/credit direction, payroll provisions, parafiscales, mapping-key ownership,
  and validation of balanced journal entries. Trigger: When working with journal
  entries, mapping keys, PUC accounts, payroll provisions, parafiscales, or any
  debit/credit logic.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
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

## Account Nature

| Class | Meaning | Normal balance | Increases with |
| --- | --- | --- | --- |
| 1 | Assets | Debit | Debit |
| 2 | Liabilities | Credit | Credit |
| 3 | Equity | Credit | Credit |
| 4 | Revenue | Credit | Credit |
| 5 | Expenses | Debit | Debit |
| 6 | Cost of sales | Debit | Debit |
| 7 | Production costs | Debit | Debit |

Practical rule: receiving money/inventory is usually debit; owing money is credit; spending is debit; selling is credit.

## Common PUC Accounts In Vendix

| Code | Use |
| --- | --- |
| `1105` | Cash |
| `1110` | Bank / cards / Wompi / PSE / Nequi |
| `1305` | Accounts receivable / customers |
| `1435` | Merchandise inventory |
| `1450` | Employee advances |
| `1520` | Property, plant and equipment |
| `1592` | Accumulated depreciation |
| `2205` | Suppliers / accounts payable |
| `2335` | Costs and expenses payable / partner commissions |
| `2365` | Withholding tax |
| `2370` | Payroll withholdings and contributions |
| `2380` | Pension payable |
| `2408` | VAT payable |
| `2505` | Salaries payable |
| `2610` | Severance provision |
| `2615` | Severance interest provision |
| `2620` | Vacation provision |
| `2625` | Service bonus provision |
| `2805` | Customer advances / wallet / layaway |
| `4135` | Sales revenue |
| `4175` | Sales returns / contra revenue |
| `4245` | Gain on asset sale |
| `4295` | Miscellaneous income / cash overage |
| `5105` | Administrative payroll expense |
| `5110` | Employer social security/parafiscal expense |
| `5195` | General expenses |
| `5199` | Provisions / depreciation expense |
| `5205` | Sales payroll expense |
| `5295` | Inventory shrinkage / commissions / shortages |
| `5310` | Loss on disposal |
| `6135` | Cost of goods sold |
| `7205` | Direct labor |

## Common Entries

- Invoice validated: DR `1305`, CR `4135`, CR `2408`.
- Payment received with invoice: DR `1105`/`1110`, CR `1305`.
- Direct POS payment: DR `1105`/`1110`, CR `4135`, CR `2408`.
- Credit sale: DR `1305`, CR `4135`, CR `2408`.
- Expense approved: DR expense, CR `2205`.
- Expense paid: DR `2205`, CR cash/bank.
- Purchase received: DR `1435`, CR `2205`.
- COGS/order completed: DR `6135`, CR `1435`.
- Refund: DR revenue/VAT reversal, CR cash/bank.
- Inventory shrinkage: DR `5295`, CR `1435`.
- Inventory surplus: DR `1435`, CR `5295`.
- Wallet top-up: DR cash/bank, CR `2805`.
- Wallet debit: DR `2805`, CR revenue or receivable target depending on flow.
- Cash register overage: credit `4295`; shortage: debit `5295`.

## Payroll Rules

- Payroll approval is accrual: debit salary/social-security expenses, credit salaries payable, deductions, and employer liabilities.
- Payroll payment is cash execution: debit payable/liability accounts and credit bank.
- Cost centers choose expense class: `administrative` -> `5105`, `sales` -> `5205`, `operational` -> `7205`.
- Monthly provisions normally use severance `2610`, severance interest `2615`, vacation `2620`, service bonus `2625`.

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
