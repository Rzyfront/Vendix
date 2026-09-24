---
id: ADR-01
title: "«Para llevar» es direct_delivery, no pickup"
status: accepted
reversibility: costly
updated: 2026-09-20
---
# ADR-01 — «Para llevar» es direct_delivery, no pickup

- **Context:** El sistema tiene dos semánticas de «llevar» conviviendo. El carril POS directo (`pos-payment.service.ts:584`) estampa `is_takeaway: true` y `delivery_type` derivado, mientras el carril del editor de órdenes (`pos-checkout-shell.component.ts:1415`) estampa `pickup`. `pickup` significa «el cliente vendrá a recogerlo después»: habilita promesa de despacho, recogida en tienda y la lógica de pendiente de entrega. `direct_delivery` significa «se entrega en el acto». Ambos son valores válidos de `order_delivery_type_enum`, y ambos están exentos de la compuerta de cobro de envío (`order-flow.service.ts:671-681`), así que el defecto no produce error: produce órdenes que prometen una recogida que nadie hará.
- **Decision:** «Para llevar» es `direct_delivery` en todos los carriles. El dueño lo decidió literalmente el 2026-09-20: *"«Para llevar» = direct_delivery — se entrega en el acto"*. El carril del editor deja de estampar `pickup` y la UI deja de ofrecer promesa de despacho para ese modo. `pickup` queda reservado para recogida diferida real. Para productos serializados, el dueño decidió el 2026-09-23 **capturar y validar el número de serie en POS antes de cobrar/entregar**; no se degrada silenciosamente a `pickup` ni se omite la trazabilidad.
- **Consequences:** F-002 cierra por coherencia, no por parche. Las órdenes `pickup` históricas siguen cobrables. El KDS distingue ENVÍO de PARA LLEVAR por `delivery_type`, sin tocar `is_takeaway`. Cualquier consumidor que trate `pickup` como «llevar» debe reescribirse. La captura serial debe cumplir cantidad, pertenencia a producto/tienda, no duplicación y persistencia transaccional antes del cobro inmediato; si falla, se bloquea la venta con error tipado.
- **Reversibility:** costly — revertir exige reescribir los mismos consumidores y dejaría órdenes nuevas con la semántica contraria a las viejas.
- **Revisit if:** el negocio introduce recogida diferida real en tienda (pedir ahora, recoger luego), en cuyo caso `pickup` vuelve a tener entrada propia y coexiste, sin reabsorber «llevar».
