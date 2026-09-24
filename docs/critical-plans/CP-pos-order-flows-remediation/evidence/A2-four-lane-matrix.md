# A.2 — matriz de cuatro carriles de cobro (sin falso gate de envío)

Verificación local cruzada; cada fila enlaza a su evidencia de ejecución. La regla de A.2 se aplica directamente al carril de detalle; los otros tres prueban que el cambio no los bloqueó ni duplicó.

| Carril del hub | Caso y resultado |
| --- | --- |
| POS directo | `H3-ui-pos-table-taxless.md`/`H3-store3-full-matrix.md`: POS mesa nueva/existente y POS sin mesa con producto taxless sin asignación, 201, IVA0, pago único; no `ORD_SHIP_CHARGE_001`. |
| Borrador reabierto | `A1-ui-full-recorrido-1153.md`: UI guardó `home_delivery` #1153, reabrió, editor200, POS201 contra **la misma orden** y pago #837; método #9/dirección #489. `A1-edited-total-1155.md` verifica total modificado $76.000 sobre la misma orden. |
| Detalle de orden | `A2-flowpay-matrix.md`: orden `dine_in` #1141 sin método mostró «Registrar Pago», `flow/pay` 200 y mesa/sesión pagadas. Control negativo: `home_delivery` #1144 sin método 422 `ORD_SHIP_CHARGE_001`/cero writes; PATCH método #9 y reintento 200. |
| Orden adoptada | `A1-same-order-api.md`: POS con `order_id=1139` cobró el draft existente, una orden/un pago; replay 409 y orden ajena 404. `A1-ui-full-recorrido-1153.md` incluye fiado adoptado #1154 con dos cuotas y CxC única. |

Adicional: `A2-flowpay-matrix.md` cubre fiado parcial `dine_in` #1146 (200), sobrepago 400 sin mutación y anónimo 401. OrderFlowService 114/114 y PaymentsService 106/106. Esta matriz verifica la exención `dine_in` y la conservación del gate de domicilio, no sanea los sobrepagos históricos DB-02/DB-14.
