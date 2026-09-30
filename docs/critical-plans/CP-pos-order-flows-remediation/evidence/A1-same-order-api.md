# A.1 — orden POS adoptada, cobro único y rechazo tipado

QA local, 2026-09-23, tienda #10; etiqueta `QA-A1-20260923-0940`. Datos sintéticos. No es evidencia de recorrido UI: ese recorrido sigue pendiente.

| Prueba | Resultado observado |
| --- | --- |
| Borrador `home_delivery` | POST `/store/payments/pos` 201, orden #1139 / `POS-2026-0331`; conteo SQL de órdenes con etiqueta = 1 antes del cobro. |
| Cobro con `order_id:1139` | POST 201, `data.order.id=1139`, pago #829 con `payments.order_id=1139`, `state=succeeded`, importe $1500.00; conteo SQL etiquetado = 1 después. |
| Replay del mismo cobro | 409 `POS_DRAFT_DUPLICATE_ORDER_001`, mensaje nombra `POS-2026-0331`; conteos permanecen en 1 orden / 1 pago. |
| `order_id:1128` de tienda #3 bajo token de tienda #10 | 404 `ORD_FIND_001`; cero nuevas órdenes/pagos. |
| Fiado libre sobre borrador #1145 | POST 201 reutiliza #1145, `credit_type=free`, `remaining_balance=1500.00`; cero pagos. Se corrigió el cálculo para conservar `Prisma.Decimal` desde el total persistido. Fiado con plazos no probado aún. |
| Limpieza de órdenes QA | `/flow/cancel` 200 para #1139, #1143, #1145; pago #829 quedó cancelled. **Hallazgo:** `accounts_receivable` #110/#111 permanecieron OPEN $1500.00 cada una para órdenes de fiado canceladas. No se modificaron a mano porque requiere reversa financiera y decisión de negocio. |

Verificación automatizada: PaymentsService 106/106 y PaymentsController 9/9 (agente A.1); Angular shipping-step 18/18 y error-messages 16/16 (orquestador). El parser conserva detalles y muestra copy español para ambos códigos de borrador. Commits de código `bad0cd84e`, `e010432b1`, `3c3190172`, `2087ecd61`.

Pendiente: recorrido real UI guardar borrador de envío → reabrir → editar → cobrar, con conteo SQL antes/después; prueba de fiado con cuotas; decisión/solución contable para CxC de órdenes canceladas. No cerrar A.1 con este documento solamente.
