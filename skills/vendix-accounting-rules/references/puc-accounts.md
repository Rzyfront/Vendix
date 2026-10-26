# PUC accounts and common entries

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
| `2365` | Withholding tax (PUC: "Retención en la Fuente") |
| `236505` | Labor withholding — retefuente salarial (child of `2365`) |
| `2370` | Payroll withholdings and contributions ("Retenciones y Aportes de Nómina"): EPS `237005`, ARL `237006`, pension `237010`, CCF `237025`, ICBF `237030`, SENA `237035` |
| `2380` | Módulo lo usa para pensión por pagar; nombre PUC real = "Acreedores Varios" |
| `2408` | VAT payable |
| `2505` | Salaries payable ("Salarios por Pagar") |
| `2510` | Cesantías Consolidadas — labor provision liability (credit) |
| `2515` | Intereses sobre Cesantías — labor provision liability (credit) |
| `2520` | Prima de Servicios — labor provision liability (credit) |
| `2525` | Vacaciones Consolidadas — labor provision liability (credit) |
| `2805` | Customer advances / wallet / layaway |
| `4135` | Sales revenue |
| `4175` | Sales returns / contra revenue |
| `4245` | Gain on asset sale |
| `4295` | Miscellaneous income / cash overage |
| `5105` | Payroll expense ("Gastos de Personal"). Employer-contribution subaccounts: EPS `510568`, pension `510569`, ARL `510570`, CCF `510572`, ICBF `510575`, SENA `510578`; provision subaccounts: severance `510530`, interest `510533`, bonus `510536`, vacation `510539` |
| `5110` | Professional fees ("Honorarios") — **NOT payroll**. Never post employer contributions here (that was a Decreto 2650 misclassification); use `5105` subaccounts |
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
