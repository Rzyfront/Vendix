---
id: ADR-10
title: "Venta sin impuesto válida también en POS mesa"
status: accepted
reversibility: costly
updated: 2026-09-22
---
# ADR-10 — Venta sin impuesto válida también en POS mesa

- **Context:** El dueño aclaró el 2026-09-22: «es decisión del cliente si vende con o sin impuestos; si vende sin impuesto no debe dar ese error». El 422 aparece al elegir «Consumir en mesa» desde POS, no desde el módulo Mesas. Ambos cobran por `POST /store/payments/pos`: Mesas agrega productos antes por `POST /store/table-sessions/:id/add-items` y cobra sin `items`; POS manda `items` en el propio cobro. `applyPosPaymentToTableSession` pasa `isTableSessionLine=true` solo a esos ítems nuevos, mientras `existingItems` no atraviesa la compuerta. `has_tax_assignment=false` significa ausencia de asignación actual, no prueba que se perdió un impuesto.
- **Decision:** Toda línea **nueva** enviada desde POS puede venderse sin impuesto, con mesa nueva o preexistente, sin exigir categoría de 0 % ni consultar si el módulo fiscal está activo. Se conserva el cálculo normal cuando sí hay asignación. Las líneas **ya persistidas** se cobran con sus snapshots `order_items`/`order_item_taxes`; no se recalculan a cero por el catálogo actual. El 422 `POS_TABLE_LINE_TAX_UNRESOLVABLE_001` no se lanza por mera ausencia de asignación en un ítem nuevo. Solo una inconsistencia fiscal demostrable con evidencia de snapshot justificaría un rechazo tipado aparte, no una inferencia desde `assignments.length=0` o desde la antigüedad de la sesión.
- **Consequences:** H.1 deja de discriminar por edad de la mesa y corrige la divergencia real entre payloads. H.2 no expone `tax_line_gate` como opción de producto para sortear un falso positivo: retira el cableado de esta compuerta y deja cualquier JSON histórico sin efecto, sin backfill ni borrado. H.3 prueba ambos recorridos y la conservación del snapshot gravado. Ausencia de impuesto no se etiqueta automáticamente como subdeclaración; una auditoría fiscal histórica requiere evidencia independiente y no bloquea este fix.
- **Reversibility:** costly — revertir restablece el 422 sobre ventas legítimas de POS mesa; los cobros ya confirmados no se revierten automáticamente.
- **Revisit if:** se define y persiste un indicador independiente de obligación fiscal o un snapshot anterior demostrable que permita diagnosticar pérdida de impuesto sin adivinarla desde la ausencia de asignación actual.
