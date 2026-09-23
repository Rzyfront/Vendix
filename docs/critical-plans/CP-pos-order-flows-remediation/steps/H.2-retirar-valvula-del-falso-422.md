---
id: H.2
title: "Retirar la válvula del falso 422 sin exponerla al comerciante"
phase: H
status: pending
owner: none
updated: 2026-09-22
contracts: [FB-64, FB-65, DB-42, ERR-01]
adrs: [ADR-10]
skills: [vendix-backend, vendix-settings-system, vendix-error-handling, how-to-test]
---
# H.2 — Retirar la válvula del falso 422 sin exponerla al comerciante

- **Skills:** `vendix-backend` (eliminar parámetros y lectura muertos del servicio) · `vendix-settings-system` (compatibilidad de JSON histórico y defaults) · `vendix-error-handling` (no mostrar un CTA fiscal falso) · `how-to-test` (verificar que settings no gobierna este cobro).
- **Resources:** `apps/backend/src/domains/store/payments/payments.service.ts` (`taxLineGateSeverity`) · `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts` · `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts` · `apps/backend/src/domains/store/settings/dto/settings-schemas.dto.ts` · `apps/backend/src/common/errors/error-codes.ts` · `apps/frontend/src/app/private/modules/store/settings/general/components/pos-settings-form/pos-settings-form.component.ts` · `apps/frontend/src/app/core/utils/error-messages.ts` · `rg -n 'tax_line_gate|POS_TABLE_LINE_TAX_UNRESOLVABLE_001' apps/backend/src apps/frontend/src`.
- **Business decision:** `tax_line_gate` no es una decisión del comerciante sobre si cada producto lleva impuesto. Al retirar el falso bloqueo (ADR-10), no se presenta `block/warn/off` como solución permanente ni un CTA «asignar impuesto» para una venta legítimamente sin impuesto.
- **Why:** H.1 deja sin consumidor útil la severidad asociada exclusivamente a ERR-01. Exponerla en Ajustes, como decía el plan previo, permitiría silenciar un diagnóstico falso a costa de dejar una configuración peligrosa y un mensaje contrario a la regla de negocio.
- **Output:** eliminar de `PaymentsService` la lectura, propagación y logging de `taxLineGateSeverity` que solo sirven a ERR-01. No crear control en el formulario POS ni mapeo de «asignar impuesto» en `error-messages.ts`. Retirar el default `pos.tax_line_gate` para tiendas nuevas; mantener el campo legacy del DTO/interfaz como **aceptado pero inerte** si un settings JSON existente aún lo envía, con comentario de deprecación. No borrar valores históricos ni usar esta clave para alterar impuestos. `ErrorCodes.POS_TABLE_LINE_TAX_UNRESOLVABLE_001` queda registrado como código legado sin lanzador, para no reutilizar su identidad.
- **Contracts touched:** FB-64, FB-65, DB-42, ERR-01
- **Data impact:** sin migración, `UPDATE` ni limpieza de JSON. Las claves históricas siguen almacenadas pero no afectan un cobro; los defaults nuevos dejan de generarlas.
- **Blast radius:** ajustes POS y cobro por mesa. Quitar la validación DTO del campo sin compatibilidad rompería el guardado de settings históricos; dejar una lectura activa permitiría que dos tiendas cobren distinto el mismo producto sin impuesto.
- **Rollback:** revertir H.2 restaura el cableado legado; si H.1 sigue aplicado, ningún ítem nuevo debe volver a bloquearse. Revertir ambos pasos restaura el bug y requiere aprobación explícita del dueño.
- **Verification:**
  - `rg -n 'taxLineGateSeverity|payments.pos_table_line_tax_unresolvable' apps/backend/src/domains/store/payments/payments.service.ts` → cero coincidencias; `rg -n 'tax_line_gate' apps/frontend/src` → cero controles nuevos.
  - `npx jest --runInBand apps/backend/src/domains/store/payments/payments.service.spec.ts` con settings legacy `block`, `warn`, `off` y ausente: mismo resultado 2xx para una línea nueva sin impuesto, con el mismo total y sin log de falso aviso.
  - `curl -sS -X PATCH "$API/store/settings" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"pos":{"tax_line_gate":"block"}}'` en dataset local con clave legacy → respuesta exitosa; `GET` conserva la clave, pero H.1 cobra la línea sin impuesto. Guardar respuesta en `evidence/H2-settings-legacy.json`.
  - `rg -n 'POS_TABLE_LINE_TAX_UNRESOLVABLE_001' apps/backend/src/domains/store/payments apps/frontend/src/app/core/utils/error-messages.ts` → cero lanzadores y cero CTA incorrectos.
- **Acceptance checklist:**
  - [ ] La severidad `block/warn/off` ya no cambia el cobro de una línea nueva sin impuesto.
  - [ ] No se expone un interruptor fiscal para esquivar el falso 422 ni un CTA «asignar impuesto» para ese caso.
  - [ ] Un JSON histórico con `tax_line_gate` sigue siendo aceptable al guardar settings y no se borra masivamente.
  - [ ] La clave no aparece en defaults de tiendas nuevas y el código legado no tiene lanzador activo.
  - [ ] Evidencia de grep, Jest y PATCH/GET local guardada bajo `evidence/`.
- **Status:** pending
