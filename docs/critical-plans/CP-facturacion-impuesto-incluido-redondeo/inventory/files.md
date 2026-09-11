# Critical Files

- `apps/backend/src/domains/store/invoicing/services/invoice-calculator.service.ts` — motor único: resolveTaxableBase + calculateLine
- `apps/backend/src/domains/store/taxes/utils/tax-inclusive-math.util.ts` — espejo puro resolveLineTotals, paridad obligatoria
- `apps/backend/src/domains/store/invoicing/utils/dian-money.util.ts` — dianAmount/dianSum/clearInclusiveLine/dianPriceAmount
- `apps/backend/src/domains/store/invoicing/invoicing.service.ts` — persiste snapshot del calculator
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/xml/ubl-common.builder.ts` — buildTaxTotals, resolveTaxCodeFromTax
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/xml/ubl-invoice.builder.ts` — cableado línea→XML
- `apps/backend/src/domains/store/invoicing/services/invoice-pdf.builder.ts` — TOTAL + letras del mismo total
- `apps/backend/src/domains/store/print-formats/providers/fiscal-document-print.mapper.ts` — snapshot a impresión + fallback + letras
- `apps/backend/src/common/utils/amount-in-words.util.ts` — amountToSpanishWords (verificación)
- `apps/frontend/src/app/private/modules/store/invoicing/utils/invoice-line-math.ts` — computeLineMath del preview
- `apps/frontend/src/app/private/modules/store/invoicing/pages/invoice-create-page/invoice-create-page.component.ts` — totals/lineMath del preview
- `apps/backend/src/domains/store/taxes/utils/tax-inclusive-math.regression.spec.ts` — matriz A.6
- `apps/backend/src/domains/store/invoicing/services/invoice-calculator.service.spec.ts` — contrato del motor
