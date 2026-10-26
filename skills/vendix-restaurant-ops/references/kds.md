# KDS: SSE, urgencia, modal, modo físico

## SSE y estados

- Subject `kitchen:{store_id}` (mismo patrón que `notifications:{store_id}`). `KdsSseService` frontend envuelve `EventSource` con backoff 1 s → 30 s, recibe `snapshot` al conectar (últimos `windowMinutes`) y mezcla eventos en un signal.
- Estados ticket/ítem: `pending → in_preparation → ready → delivered` (+ `cancelled`). Eventos `ticket.created|started|ready|delivered|cancelled`, emitidos por el servidor tras commit.
- Estaciones: módulo `apps/backend/src/domains/store/kds/`; cascada `skip_kds` → `products.kds_id` → KDS por defecto de la tienda.
- Board: `apps/frontend/src/app/private/modules/store/restaurant-ops/kds/` (4 columnas; reusar `app-sticky-header`, `app-stats`, `app-card`, `app-button`, `app-badge`, `app-icon`, `app-toast`, `app-spinner`).

## Urgencia de tarjeta

`preparation_time_minutes` (producto o variante, vía `KITCHEN_TICKET_INCLUDE`). Se usa el MENOR del ticket; faltante/0/negativo = 10 min.
- Warning: `elapsed >= prep * 60 s`. Danger: `elapsed >= (prep + 5) * 60 s`. Ambos suprimidos en `delivered`/`cancelled`.
- Clase legacy `--urgent` = alias de `--warning`; no borrar sin auditar.
- Un solo ticker `now` para todo el board.

## Modal de detalle (`kds/components/kds-ticket-detail-modal/`)

Cabecera de orden, ítems (cantidad, nombre, notas, prep), receta activa por `RecipesService.getByProduct` cacheada por `product_id` en un `Map`; 403/404 → "Receta no disponible" (nunca bloquear ni tocar permisos). Acciones Start/Ready/Deliver/Cancel re-emiten al padre (SSE es la fuente de verdad). El modal se deriva de `tickets()` por id (vivo); footer con `$event.stopPropagation()`.

## Estado de cocina en el detalle de orden

`GET /api/store/orders/:id` incluye `kitchen_ticket_items` (desc por id) por `order_item`. Badge "Cocina: <estado>": pending→neutral, in_preparation→warning, ready→success, delivered→info, cancelled→error. `kitchenStateFor(item)` prefiere fila no terminal sobre la terminal más reciente.

## Modo físico vs virtual (`store_settings.settings.restaurant.kitchen_mode`)

`'virtual' | 'physical'`, excluyentes. Faltante/null/basura → `'virtual'` vía `normalizeKitchenMode` / `resolveKitchenMode` (`kitchen-fire/kitchen-mode.util.ts`), único lector backend. Nunca leer ad hoc ni defaultear a physical.

Físico (comandas en papel):
- Mismos tickets, estaciones e inventario/COGS en fire. Tickets e ítems nacen `in_preparation` (`fireOrderItemsInTx`, `resendOrderItems`); entrega permitida desde cualquier estado no terminal (`canDeliverItem`; `deliverOrderItem` / `syncKitchenOnOrderItemDelivered` saltan `ready`; `markDelivered` acepta `pending`); `auto_fire` efectivo del QR = `false` (`getQrSettings`) porque "el dispositivo que dispara imprime".
- Las compuertas de cierre (`hasPendingKitchenItems`, `kitchenHandoffBlocker`, auto-finish) NO se relajan: se cumplen marcando entregado.
- Frontend: `KitchenTicketPrintService` (`restaurant-ops/kds/services/`, `isPhysicalKitchen`) es el único lector. `printAfterFire(kitchen_ticket_ids)` tras cada fire (POS, checkout shell, mesa, detalle, reenvío): no-op en virtual, dedupe 30 s, respeta `is_active`/`auto_print` del formato `kitchen_ticket`. `printTickets` = "Imprimir comanda". Detalle: "Entregar todo" secuencial por `deliverOrderItem`. Ítem de menú "Comandas" (`restaurant_ops_kds`) oculto por `MenuFilterService.hiddenBySettings`.
- Una estación y una hoja por ronda:
  1. Fire/resend envían todo al KDS por defecto e ignoran `products.kds_id` (se conserva) → un `kitchen_tickets` por ronda.
  2. `print-formats/providers/kitchen-ticket.provider.ts`: con cualquier ticket id de la orden, una hoja con todos los `kitchen_ticket_items` no entregados/cancelados: orden #, comanda #, servicio (Domicilio / Mesa X / Para llevar), mesa, cliente, mesero; por ítem `packaging_label` (ENVÍO / PARA LLEVAR), exclusiones ("SIN x"), nota; nota de la orden; sin `kds_name`. `print-layout-composer.service.ts` habilita estas líneas solo si `document.is_kitchen_ticket === true` (plantillas guardadas no se migran).
  3. `kitchen-ticket-print.service.ts` colapsa ids a uno: un evento = una impresión.
  4. Formulario de producto: selector "Estación de preparación" oculto y payload sin `kds_id`.
  5. **Regla duplicada:** etiquetas de empaque/servicio en frontend (`kds-ticket-card.component.ts` `itemDeliveryBadge`) Y en el provider backend. Cambiar ambos.
- `window.print()` (un diálogo por comanda); impresión silenciosa con Chrome `--kiosk-printing`.
