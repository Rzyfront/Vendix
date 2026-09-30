# E.6 — base bruta de propina porcentual (2026-09-23)

ADR-11 aceptado: 10 % sobre productos $100.000 + impuesto $19.000 → propina $11.900. La base excluye envío, descuento aplicado como renglón aparte y propina previa; no cambia IVA ni se reliquidan ventas históricas.

`flow/pay` dejó de pasar el subtotal neto; POS retail retiró la implementación inline y delega a `resolveTip`, como ya hacía POS mesa. Los tres conservan redondeo monetario y persisten la propina como monto fijo para que no se mueva después.

Pruebas red→green: `flow/pay` devolvía $10.000 y el retail no delegaba. Jest `tip.util.spec.ts` + `payments.service.spec.ts` + `order-flow.service.spec.ts`: **249/249** green. Casos con $2.000 de descuento y $5.000 de envío demuestran base $119.000, propina $11.900 y `grand_total` $133.900 sin contaminar `subtotal_amount`/`tax_amount`. Pendiente curl+SQL representativo de los tres carriles y barrido DB-02 antes de cerrar E.6.
