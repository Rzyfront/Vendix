---
id: ADR-05
title: "La dirección de una venta con alias vive como fila huérfana más snapshot"
status: accepted
reversibility: costly
updated: 2026-09-23
---
# ADR-05 — La dirección de una venta con alias vive como fila huérfana más snapshot

- **Context:** El dueño pidió poder vender con envío a un nombre de referencia sin crear cliente, y preguntó explícitamente dónde guardar la dirección. El esquema ya soporta el caso: `orders.customer_alias` con el CHECK `orders_customer_xor_alias` (`schema.prisma:1509-1513`) y el par `shipping_address_id` + `shipping_address_snapshot` (`:1517-1519`). `addresses.user_id` es nullable. Hay tres gates en el frontend que hoy lo impiden, y una mina: `addresses.service.ts:96-102` apaga `is_primary` de toda la tienda cuando crea una dirección sin cliente, porque el `updateMany` que despriman las demás no filtra por `user_id` cuando este es nulo.
- **Decision:** La dirección se persiste **dos veces**: como fila real en `addresses` con `user_id = NULL` (para que la lean los consumidores que siguen la FK: remisión, ruta, mapa, geocodificación) y como `shipping_address_snapshot` en la orden (para que la lean los que muestran texto y para que sobreviva a cualquier edición posterior). No se crea cliente fantasma, no se reutiliza el cliente genérico y no se guarda solo el snapshot.
- **Consequences:** Dos consumidores distintos siguen funcionando sin cambios, que es la razón de no elegir «solo snapshot»: la remisión y el mapa de rutas resuelven por FK. La mina de `is_primary` debe desactivarse **en el mismo paso** que levanta los gates, no después: son un único cambio, porque separarlos publica el defecto. Las direcciones huérfanas quedan identificables por `user_id IS NULL`, pero **`addresses` no tiene `created_at` ni `updated_at`**: no se pueden acotar por fecha, así que un rollback selectivo tiene que cortar por `orders.created_at` a través de la FK, no por la propia fila. Si el cliente se registra más tarde, la fila se puede adoptar asignándole `user_id`, sin migración.
- **Reversibility:** costly — revertir deja órdenes con alias y dirección que la UI ya no sabe crear; las existentes siguen siendo legibles por snapshot.
- **Revisit if:** el negocio decide que toda venta con envío exige cliente registrado, en cuyo caso el alias deja de aplicar al carril de envío y estos gates vuelven, esta vez con mensaje.

- **Owner approval:** 2026-09-23 — el dueño autorizó expresamente las cuatro propuestas ADR-05/06/07/08 para completar el plan.
