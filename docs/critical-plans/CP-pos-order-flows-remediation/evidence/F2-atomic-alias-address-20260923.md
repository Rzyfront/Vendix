# F.2 — dirección de alias atómica con la orden POS (2026-09-23)

ADR-05 exige fila real sin cliente + snapshot en la orden. Crear primero la fila con `POST /store/addresses` y luego intentar cobrar deja una huérfana si el cobro falla o se abandona: DB-25 no queda garantizada. La ruta backend ahora valida `shipping_address_snapshot` para alias `home_delivery` y, dentro de **la misma transacción** que crea/actualiza la orden, crea la fila `addresses` (`user_id=NULL`, `is_primary=false`, `store_id` del contexto) y escribe `orders.shipping_address_id`. El snapshot queda en la orden. Si se revierte la transacción, se revierten ambas escrituras.

Un borrador adoptado reutiliza su propia dirección huérfana solo si no tiene otros consumidores (otras órdenes, factura de venta, booking, ubicación o proveedor); no muta libreta de cliente ni toma dirección de otra venta. El backend rechaza un ID externo bajo alias con `PAY_VALIDATE_001`.

Prueba roja antes del cambio: no existía `addresses.create` ni enlace FK. Tras el cambio, `payments.service.spec.ts` **113/113** green (alta, borrador adoptado, ID prestado, resto POS). El frontend debe mandar snapshot con coordenadas y omitir `shipping_address_id` para alias nuevo; E2E/curl+SQL de DB-25 pendientes.
