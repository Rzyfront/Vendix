# F.2 — API/SQL real en desarrollo local (2026-09-23)

Tienda #10 (`pos.allow_alias_sales=true`), producto de servicio #425, método de envío #9, `customer_alias` sin ficha de cliente. Token QA owner; no producción.

- **Feliz:** `POST /store/payments/pos` con `is_draft=true`, `requires_payment=false`, `delivery_type=home_delivery`, snapshot con dirección/coordenadas y sin `shipping_address_id` → HTTP **201**, orden #1191. SQL: `orders.state=draft`, `shipping_address_id=539`, snapshot no nulo; `addresses #539` tiene `store_id=10`, `user_id=NULL`, `is_primary=false`, línea de dirección y coordenadas `4.61234500/-74.08765400`. Se canceló el borrador por `POST /store/orders/1191/flow/cancel` → HTTP **200**; la dirección sigue referenciada por la orden cancelada, no queda suelta.
- **Triste/rollback:** mismo alias con método de pago inexistente #99999999 → HTTP **400** `PAY_METHOD_DISABLED_001`, `reason=payment_method_not_found`; conteo de direcciones huérfanas de tienda 10 **3→3**, órdenes con ese alias **0**. El cobro no persistió ni orden ni dirección.
- **Abuso:** spec `payments.service.spec.ts` rechaza `shipping_address_id` prestado por otra venta bajo alias con `PAY_VALIDATE_001`; la creación no acepta `customer_id` dentro del snapshot para asignar la fila (fuerza `user_id=NULL`).

Evidencia local adicional sin credenciales: `/tmp/f2-atomic-draft.response.json`, `/tmp/f2-atomic-draft-cancel.response.json`, `/tmp/f2-atomic-rollback.response.json`. Frontend E2E y selector de direcciones pendientes.
