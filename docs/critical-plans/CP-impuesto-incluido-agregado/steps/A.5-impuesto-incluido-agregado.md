---
id: A.5
title: "Frontend detalle y masiva contra la verdad persistida"
phase: A
status: done
owner: none
updated: 2026-09-10
contracts: [FB-01, FB-02, FB-03, FB-04]
adrs: [ADR-01]
skills: [vendix-frontend, vendix-zoneless-signals]
---
# A.5 — Frontend detalle y masiva contra la verdad persistida

- **Skills:** vendix-frontend, vendix-zoneless-signals
- **Resources:** `product-create-modal.component.ts:101,253,321,356`, `bulk-edit-field-control.component.ts:91,150,181`, `bulk-edit.interface.ts:86`, `products-bulk-edit.service.ts`
- **Business decision:** Los chips muestran y guardan la verdad por asignación; al reabrir, el valor persiste (fin del "siempre agregado").
- **Why:** Detalle hidrata de catálogo (`:321`, `:356`) y su mapa se descarta en backend; masiva emite sin destino (`tax_category_action` solo `{mode,ids}`).
- **Output:** Detalle hidrata chips desde `assignments.is_inclusive` y envía el mapa al contrato A.2; masiva incluye `inclusive?` en la acción y el padre lo envía; preview lo refleja; estimado existente se conserva como especificación visible.
- **Contracts touched:** FB-01, FB-02, FB-03, FB-04.
- **Data impact:** Ninguno directo (solo payloads); la escritura la hace A.2.
- **Blast radius:** Dos módulos de productos; resto del frontend intacto. Señales Zoneless existentes, sin nuevos patrones.
- **Rollback:** Revert del commit frontend; backend A.2 sigue aceptando payloads viejos (mapa opcional).
- **Verification:**
  - `ng build` producción del frontend en verde
  - manual guiado: marcar incluido → guardar → reabrir → chip conserva; masiva replace → `GET` flags
  - preview masiva == apply en lote de prueba (FB-04)
- **Acceptance checklist:**
  - [ ] Detalle reabierto conserva incluido/agregado por categoría
  - [ ] Masiva persiste el flag en add/remove/replace
  - [ ] Estimado del modal == total backend de A.3 al centavo
  - [ ] Sin regresión visual en chips (build + smoke)
  - [ ] F-007 — Hidratacion detalle lee catalogo, no asignacion (major)
  - [ ] F-019 — Toggle catalogo muerto que miente; re-etiquetar default (minor)
  - [ ] F-021 — onSubmit del modal nunca envia el mapa (blocker)
  - [ ] F-022 — Interface ProductTaxAssignment sin campo + page hidrata catalogo (blocker)
  - [ ] F-023 — Mapa sobrevive entre productos (fuga de estado) (major)
  - [ ] F-024 — Carrera populate vs loadTaxCategories sin precedencia (major)
  - [ ] F-028 — Mapa masiva vive en hijo y nunca entra al payload (blocker)
  - [ ] F-032 — Quitar impuesto no limpia su entrada del mapa (minor)
- **Status:** done
