# Critical Files

<!-- [MANDATORY] Concrete paths only, zero wildcards — one line per file: `path/to/file.ts` — role. -->

`apps/frontend/src/app/private/modules/store/products/components/product-create-modal.component.ts` — Detalle producto: chips incluido/agregado, `taxInclusiveMap:101`, toggle `:125`, payload `tax_inclusive_map:253`, estimado `:265`, hidratación edit `:321` y `:356`.
`apps/frontend/src/app/private/modules/store/products/bulk-edit/bulk-edit-field-control.component.ts` — Masiva: control presentacional, `taxInclusiveMap:91`, chips `:150`, toggle `:181`, solo emite (docblock `:12`).
`apps/frontend/src/app/private/modules/store/products/bulk-edit/bulk-edit.interface.ts` — `BulkEditableChanges.tax_category_action:86` (`{mode, ids}`, sin inclusivo) y exclusión deliberada `:74`.
`apps/frontend/src/app/private/modules/store/products/bulk-edit/products-bulk-edit.service.ts` — POST `/store/products/bulk-edit` y `/preview`, `changes` sin mapa inclusivo.
`apps/backend/src/domains/store/products/products.service.ts` — Crea asignaciones solo con ids (`createMany:1031`, validación `:1001`); update anidado `:2057`; lectura `:1180`.
`apps/backend/src/domains/store/products/products-bulk-edit.service.ts` — Aplica `tax_category_action` delegando en `update()` (`:408`, `:427`); preview `:217`.
`apps/backend/src/domains/store/products/dto/index.ts` — `tax_category_ids` en create/update/bulk (`:678`, `:1134`, `:1761`, `:1921`); aquí entra el nuevo campo mapa.
`apps/backend/src/domains/store/products/dto/bulk-edit-products.dto.ts` — `BulkRelationalTaxActionDto {mode, ids}` (`:68`); aquí entra `inclusive?`.
`apps/backend/src/domains/store/taxes/taxes.service.ts` — `calculateProductTaxes:86`, fórmula siempre-aditiva `:134`; fuente de la verdad a corregir.
`apps/backend/src/domains/ecommerce/shared/services/storefront-price.service.ts` — Vitrina: `net*(1+rate):76`, suma tasas `:196`; sin concepto inclusivo.
`apps/backend/src/domains/ecommerce/checkout/checkout.service.ts` — Checkout web: consume `calculateProductTaxes` para totales.
`apps/backend/src/domains/store/orders/orders.service.ts` — Segundo resolver de impuesto `:3501` (break primera categoría, `take:1`); diverge además.
`apps/backend/src/domains/store/payments/payments.service.ts` — `rescaleTaxInfo:2788` re-escala el desglose; snapshot de ítem posterior.
`apps/backend/src/domains/store/invoicing/invoicing.service.ts` — Emite factura; debe heredar `is_inclusive` por línea (ver CP-facturacion-fixes A.1-A.4).
`apps/backend/prisma/schema.prisma` — `tax_categories.is_inclusive:2297` (semántica documentada), `product_tax_assignments:1732` (SIN flag: el eslabón roto), `invoice_items/invoice_taxes.is_inclusive`.
