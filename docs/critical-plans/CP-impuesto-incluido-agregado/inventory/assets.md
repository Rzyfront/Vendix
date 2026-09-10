# Reusable Assets

`TaxInclusiveChipComponent` (frontend compartido) — Chip incluido/agregado ya usado en detalle y masiva; reutilizar sin duplicar.
`calculateEstimatedPrice()` del modal detalle — Fórmula correcta de referencia: base despejada `p/(1+r)` si inclusivo, `p + base*r` si agregado; el backend debe igualarla.
`BulkRelationalTaxActionDto {mode, ids}` — Patrón add/remove/replace a extender con `inclusive?`, no un endpoint nuevo.
`calculateProductTaxes()` (`taxes.service.ts:86`) — Punto único de resolución backend; todos los canales lo consumen o lo re-escalan.
`rescaleTaxInfo()` (`payments.service.ts:2788`) — Patrón de re-escalado a extender propagando el flag en vez de recalcular.
`tax_categories.is_inclusive` (schema + comentario `:2291`) — Default de negocio al asignar; el plan lo congela como default, no como switch de venta.
Migraciones aditivas CP-facturacion-fixes (`20260910120000/130000/140000`) — Precedente de migración fiscal segura (sin CASCADE, con backfill).
Scripts `cp-new/cp-lint/cp-ledger/cp-context.sh` — Tooling del bundle, ya operativo en este plan.
