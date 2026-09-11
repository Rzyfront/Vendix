# Database Contract Registry

| Id | Model / table | Columns | R/W | Tenant scoping | Migration | Consumers | Invariant | Verification | Status |
|----|---------------|---------|-----|----------------|-----------|-----------|-----------|--------------|--------|
| DB-01 | `invoices` | `subtotal_amount,discount_amount,tax_amount,total_amount` | W vía calculator en `invoicing.service.ts` | scoped client por store/organización | none | pdf.builder, mapper, UBL, CUFE | `total = subtotal - discount + tax`; tras emitir inmutable | specs calculator + `ubl-monetary-total.builder.spec.ts` en verde | [ ] |
| DB-02 | `invoice_items` | `unit_price,quantity,discount_amount,tax_amount,total_amount,is_inclusive` | W vía calculator | relacional vía `invoices` | none | mapper items, UBL líneas | `total_línea = base + cuotas = bruto` en inclusivas | spec A.1/A.2 con $3.000 y $5.000 | [ ] |
| DB-03 | `invoice_taxes` | `tax_name,tax_rate,taxable_amount,tax_amount,tax_type` | W vía `aggregateHeaderTaxes` | relacional vía `invoices` | none | `buildTaxTotals`, CUFE ValImp | cabecera = Σ líneas truncadas; `cuota = trunc(base × rate)` | `ubl-common.builder.spec.ts` en verde | [ ] |
| DB-04 | `order_item_taxes` | `is_inclusive,tax_amount` | R como semilla del despeje | relacional vía `orders`→tienda | none | `from-order` y POS (`invoicing.service.ts:2080`) | inclusividad de la orden viaja intacta a la factura | suite `invoicing.service.*.spec.ts` en verde | [ ] |
