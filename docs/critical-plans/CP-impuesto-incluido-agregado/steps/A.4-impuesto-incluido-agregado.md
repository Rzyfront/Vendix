---
id: A.4
title: "Canales restantes: orders, checkout, POS y herencia a factura"
phase: A
status: in-progress
owner: none
updated: 2026-09-10
contracts: [FB-06, FB-07, DB-05, DB-07, ERR-03]
adrs: [ADR-02]
skills: [vendix-tax-typing, vendix-accounting-rules, vendix-backend]
---
# A.4 — Canales restantes: orders, checkout, POS y herencia a factura

- **Skills:** vendix-tax-typing, vendix-accounting-rules, vendix-backend
- **Resources:** `orders.service.ts:3501`, `checkout.service.ts`, `order-flow.service.ts`, `invoicing.service.ts`, `invoice-flow.service.ts`
- **Business decision:** Todo canal vende con la misma fórmula de A.3; la factura hereda `is_inclusive` de la asignación a `invoice_items/invoice_taxes` y despeja base (conecta con CP-facturacion-fixes).
- **Why:** El segundo resolver de orders (`:3501`) ignora flags y además diverge (break + take:1); checkout/WhatsApp/POS suman vía el contrato viejo; la factura sumaría encima sin herencia.
- **Output:** DECISIÓN USUARIO 2026-09-10 (F-002/F-015): se elimina el segundo resolver como decisor; delega en `calculateProductTaxes` y persiste N filas `order_item_taxes` (una por tasa, cada una con su `is_inclusive`; requiere columna aditiva en A.1). Checkout/WhatsApp/POS consumen el contrato A.3; emisión setea `is_inclusive` por línea con base despejada y precedencia override-línea > asignación > catálogo (F-020); invariante ERR-03 (tasa ausente → impuesto 0, sin 500).
- **Contracts touched:** FB-06, FB-07, DB-05, DB-07, ERR-03.
- **Data impact:** `invoice_items/invoice_taxes.is_inclusive` se escriben al emitir (columnas existentes); órdenes/pagos guardan snapshots con la semántica nueva solo en ventas nuevas.
- **Blast radius:** Ventas nuevas con líneas inclusivas; ventas agregadas = idéntico a hoy. Histórico intacto (snapshots).
- **Rollback:** Revert del commit + retener migración A.1 (columna sin uso). Facturas ya emitidas no se reescriben.
- **Verification:**
  - specs checkout/WhatsApp/POS: línea inclusiva 19% → total == precio; agregada → suma
  - spec segundo resolver: caso 1:1 honra flag; caso multi sin cambio de ganador
  - factura e2e desde venta inclusiva: total == precio, `is_inclusive` seteado, base despejada
- **Acceptance checklist:**
  - [ ] Ningún canal suma encima una línea marcada incluida
  - [ ] Desempate multi-categoría conserva ganador actual (solo suma el flag)
  - [ ] Factura hereda flag y despeja base por línea
  - [ ] Tasa ausente/0% → impuesto 0 sin error 500
  - [ ] F-002 — Segundo resolver winner-takes-all pierde tasas en mixtos POS (blocker)
  - [ ] F-015 — Select sin flags y ganador puede ser el flag equivocado (major)
  - [ ] F-020 — Precedencia factura: override linea mayor que asignacion (note)
- **Status:** in-progress
