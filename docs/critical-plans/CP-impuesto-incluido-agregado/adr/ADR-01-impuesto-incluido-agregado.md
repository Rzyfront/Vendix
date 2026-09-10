---
id: ADR-01
title: "Fuente de la verdad: is_inclusive por asignacion producto-categoria"
status: proposed
reversibility: costly
updated: 2026-09-10
---
# ADR-01 — Fuente de la verdad: is_inclusive por asignación producto-categoría

- **Context:** El flag vive hoy en `tax_categories.is_inclusive` (default de negocio) pero ningún cálculo lo lee; el toggle por producto del detalle/masiva no persiste en ningún lado. Hay tres candidatos a verdad: catálogo, asignación, línea de factura.
- **Decision:** La verdad para ventas es `product_tax_assignments.is_inclusive` (nueva columna). Al asignar una categoría a un producto sin valor explícito, se hereda el `tax_categories.is_inclusive` vigente (backfill + default en escritura). Cambios posteriores del catálogo NO reescriben asignaciones existentes. La línea de factura hereda de la asignación al emitir.
- **Consequences:** El precio de venta queda congelado contra cambios del catálogo (estable y auditable); el admin de impuestos conserva su rol como default para futuras asignaciones; un producto puede vender inclusivo lo que en catálogo es agregado y viceversa, que es justo lo que piden detalle y masiva.
- **Reversibility:** costly — requiere migración de borrado + re-backfill; los datos históricos ya escritos con la nueva columna no se reinterpretan.
- **Revisit if:** se pide inclusivo por variante, por lista de precios o por canal (hoy fuera de alcance).
