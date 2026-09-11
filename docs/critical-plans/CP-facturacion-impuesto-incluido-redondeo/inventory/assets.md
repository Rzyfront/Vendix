# Reusable Assets

- `apps/backend/src/domains/store/invoicing/utils/dian-money.util.ts` — truncado y escala centralizados, no duplicar
- `apps/backend/src/domains/store/invoicing/services/invoice-calculator.service.ts` — única fuente de verdad servidor
- `apps/backend/src/domains/store/taxes/utils/tax-inclusive-math.util.ts` — resolveLineTotals y truncMoney de canales
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/xml/ubl-common.builder.ts` — buildTaxTotals y resolveTaxCodeFromTax
- `apps/backend/src/common/utils/amount-in-words.util.ts` — amountToSpanishWords para letras
- `apps/frontend/src/app/private/modules/store/invoicing/utils/invoice-line-math.ts` — computeLineMath del preview
- `apps/frontend/src/app/shared/pipes/currency/currency.pipe.ts` — pipe de moneda del display
