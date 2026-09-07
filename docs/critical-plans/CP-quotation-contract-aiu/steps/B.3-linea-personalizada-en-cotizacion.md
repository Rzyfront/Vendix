---
id: B.3
title: "Linea personalizada en cotizacion"
phase: B
status: done
owner: none
updated: 2026-09-06
contracts: [FB-12]
adrs: []
skills: [vendix-frontend, vendix-zoneless-signals, vendix-angular-forms, vendix-backend-api]
---
# B.3 — Linea personalizada en cotizacion

- **Skills:** vendix-frontend, vendix-zoneless-signals, vendix-angular-forms, vendix-backend-api
- **Resources:** invoice-custom-item-modal.component.ts (patron), quotation-form-modal.component.ts, quotations.service.ts:440 (convertToOrder propaga lineas)
- **Business decision:** Cotizar admite linea libre (nombre, cantidad, precio, impuesto) igual que POS y factura; sin perfil tambien vale.
- **Why:** Obra y servicios cotizan conceptos que no existen como producto; sin linea libre la cotizacion no sirve.
- **Output:** Modal de linea personalizada en cotizacion + propagacion a orden/contrato/factura con `product_id` nulo y nombre libre.
- **Contracts touched:** FB-12
- **Data impact:** none — `quotation_items.product_id` ya es nullable; sin migracion.
- **Blast radius:** Modal y conversion. Una linea libre mal propagada pierde totales al convertir.
- **Rollback:** Ocultar opcion de linea libre; las ya creadas siguen validas por schema.
- **Verification:**
  - Crear cotizacion con linea libre y convertir a orden y a contrato sin perder totales
  - Linea libre llega a factura AIU con descripcion y base correctas
- **Acceptance checklist:**
  - [x] Modal crea linea sin producto con impuesto editable
  - [x] Conversion conserva nombre, cantidad, precio e impuesto (`custom`, null-safe verificado en codigo)
  - [ ] Totales de cabecera cuadran con lineas libres incluidas en vivo (E.1)
- **Status:** done (degradado: interaccion viva queda para E.1; evidencia en evidence/B.3-linea-libre-evidence.md)
