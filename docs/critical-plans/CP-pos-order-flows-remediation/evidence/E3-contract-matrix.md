# E.3 Contrato de creación: tipo de entrega y canal

Tienda QA local #10, `POST /store/orders` con producto servicio 425 y estado draft:

| Payload | HTTP | Persistido (SQL) |
|---|---:|---|
| `delivery_type=dine_in, channel=pos` | 201 | orden #1147: `dine_in/pos` |
| `delivery_type=home_delivery, channel=whatsapp` | 201 | orden #1148: `home_delivery/whatsapp` |
| ambos omitidos | 201 | orden #1149: `direct_delivery/pos` |
| `channel=telegram` | 400 | `SYS_VALIDATION_001`, `details.validationErrors` enum |
| `delivery_type=takeaway` | 400 | `SYS_VALIDATION_001`, `details.validationErrors` enum |
| clave desconocida `canal=pos` | 400 | `SYS_VALIDATION_001`, `details.validationErrors` whitelist |

La UI real del detalle de la orden API #1148 mostró «Envío a domicilio» (`E3-home-whatsapp-detail.png`). Los tres drafts QA se cancelaron auditadamente con `flow/cancel` 200; el tipo y canal originales permanecieron en las filas (`E3-persisted.sql/txt`). El spec `orders.service.spec.ts` cubre valor declarado, defaults, `home_delivery` y validación del DTO; OrdersService suite 105/105 pasó en este tramo.

**Ajuste de alcance DB-05:** ADR-01 exige que la acción UI «Para llevar» sea `direct_delivery`, pero `pickup` sigue siendo un modo explícito de recogida diferida permitido por la API/POS. Por eso un conteo global de cero `channel=pos AND delivery_type=pickup` es inválido; en QA hay órdenes POS #1140/#1142 de E.2 con `pickup` explícito. El caso de producto serializado que fuerza pickup sigue pendiente de la decisión E.1, no de esta persistencia.
