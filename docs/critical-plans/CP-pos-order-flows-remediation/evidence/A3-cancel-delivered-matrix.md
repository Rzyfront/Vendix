# A.3 — reversa de línea entregada: cobrada bloqueada, sin cobrar aceptada

QA local tienda #10, 2026-09-23, Playwright standalone en `vendix.com` y curl en `api.vendix.com`. ADR-02 vinculante: tras cobro se usa Reembolso, no se baja el total.

| Caso | Resultado | Integridad |
| --- | --- | --- |
| Orden #1091 `finished`, pago efectivo `succeeded`, ítem entregado #1802 | `POST /flow/items/1802/cancel-delivered` → **409 `ORD_ITEM_CANCEL_PAID_001`**, CTA «Usa Reembolso». Playwright abrió Reversar → motivo → destino waste y vio el mismo 409/toast (`A3-ui-paid-reject.png`). | Ítem sigue entregado/no cancelado; orden sigue $3.299.000 y pago intacto. |
| Orden #1012 `cancelled`, sin pago, ítem entregado #1696 | POST → **409 `ORD_ITEM_CANCEL_STATE_001`**, `details.state=cancelled`. | Ítem y total intactos. |
| Draft QA #1160, producto físico #302, ítem entregado #1883 sin pago | POST con motivo/destino waste → **200**, soft cancel `delivered_waste`, subtotal/tax/grand_total $0, cero pagos y cero movimientos de inventario. | Audit #55046 existe con `resource_id=1160`, `metadata.order_item_id=1883`. |
| Draft QA #1161, mismo producto, ítem entregado #1884 sin pago | Playwright Reversar → motivo → waste → **200** y toast «Entrega reversada» (`A3-ui-open-success.png`); detalle refrescó total $0. | Audit #55072 `resource_id=1161`, `metadata.order_item_id=1884`; cero pagos/stock tx. |

Jest `order-cancellation-policy.util.spec.ts` **46/46** y `order-flow.service.spec.ts` **118/118**. `SETTLED_PAYMENT_STATES` contiene succeeded/captured/partially_refunded/refunded, no pending. Código del guard corre antes de la transacción de recálculo.

**Corrección del comando del plan:** la fila de auditoría usa `AuditResource.ORDERS` y se llavea por `resource_id=$ORDER_ID`; el ítem está en `metadata.order_item_id`. Consultar `resource_id=$ITEM_ID` devuelve 0 aun si se auditó correctamente. No se reescribieron órdenes históricas sobrepagadas.
