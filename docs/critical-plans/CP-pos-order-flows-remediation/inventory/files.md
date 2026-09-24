# Critical Files

<!-- [MANDATORY] Concrete paths only, zero wildcards — one line per file: `path/to/file.ts` — role. -->
<!-- Toda ruta de este archivo fue verificada contra el árbol de trabajo (2026-09-20). El rol dice POR QUÉ el plan la toca. -->

## Backend — órdenes y flujo de orden

- `apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts` — epicentro del plan: aquí viven el carril `flow/pay` que no proyecta sobre la mesa (F-026), los dos guards muertos de `cancelDeliveredOrderItem` que dejan bajar el total de una orden cobrada (ADR-02), el gate `ORD_SHIP_CHARGE_001` que hoy no exime `dine_in`, la arista `delivered→processing` sin dueño (F-016), el seam `deliverOrderItem` que ADR-06 convierte en destino único de la entrega, y la reversa de BOM de `cancelOrder` que ADR-08 reutiliza.
- `apps/backend/src/domains/store/orders/order-flow/order-flow.controller.ts` — publica `flow/pay`, `flow/items/:id/cancel-delivered` y `flow/items/:id/deliver`; cualquier cambio de contrato de cancelación o de entrega (destino reuse/waste, nuevo código tipado) se declara aquí antes de tocar el frontend.
- `apps/backend/src/domains/store/orders/order-flow/dto/cancel-order.dto.ts` — transporta `kitchenDisposition` (`reuse`/`waste`); la fase D unifica el vocabulario de destino entre cancelar-orden y cancelar-línea, que hoy diverge.
- `apps/backend/src/domains/store/orders/order-flow/dto/pay-order.dto.ts` — contrato del carril de cobro que hoy no valida sobrepago ni proyecta mesa; la fase B y el residuo F-003 pasan por él.
- `apps/backend/src/domains/store/orders/order-flow/order-lifecycle-lock.util.ts` — `lockOrderLifecycle` es el lock de fila que la proyección canónica (ADR-03) y la reasignación de mesa (ADR-07) deben tomar para no escribir sobre una orden que otro carril está cobrando.
- `apps/backend/src/domains/store/orders/order-flow/order-cancellation-policy.util.ts` — ya deriva «orden liquidada» de `payments` con el conjunto `succeeded|captured|partially_refunded|refunded`; ADR-02 necesita exactamente esa derivación para reemplazar el guard que lee una columna inexistente.
- `apps/backend/src/domains/store/orders/order-flow/listeners/kitchen-order-delivered.listener.ts` — puente cocina→orden que mueve `processing→delivered`; el reenrutado de la entrega (ADR-06) debe dejar este listener con el mismo criterio all-terminal.
- `apps/backend/src/domains/store/orders/order-flow/listeners/kitchen-order-delivery-reverted.listener.ts` — único consumidor legítimo de la arista `delivered→processing` que F-016 quiere acotar por llamador.
- `apps/backend/src/domains/store/orders/order-flow/services/refund-calculation.service.ts` — tope de reembolso anclado a `grand_total`; queda descuadrado si el sobrepago de F-003 sigue siendo posible (F-004, fase I).
- `apps/backend/src/domains/store/orders/order-flow/services/refund-flow.service.ts` — el carril de devolución al que ADR-02 manda el caso post-cobro; hay que confirmar que existe salida real antes de bloquear la cancelación.
- `apps/backend/src/domains/store/orders/orders.service.ts` — contiene el guard `ORD_EDIT_NOT_ALLOWED_001` que dejaría inmutable una orden reasignada (F-029/ADR-07) y el `create` que no persiste `delivery_type` ni `channel` (F-013), causa aguas arriba de que el KDS no distinga envío de llevar.
- `apps/backend/src/domains/store/orders/orders.controller.ts` — expone el `PATCH /store/orders/:id` por el que hoy entra la reversa de entrega sin motivo (F-016) y por el que entraría la reasignación si no se le da endpoint propio.
- `apps/backend/src/domains/store/orders/dto/create-order.dto.ts` — acepta `delivery_type` que el servicio descarta; la fase E lo persiste o lo rechaza explícitamente.
- `apps/backend/src/domains/store/orders/dto/bulk-orders.dto.ts` — el carril bulk ya cerró su lista de destinos; se revisa para que el acotamiento unitario de F-016 no lo contradiga.
- `apps/backend/src/domains/store/orders/orders-bulk.service.ts` — segundo escritor de estado masivo; verifica que el guard nuevo no rompa la transición masiva legítima.
- `apps/backend/src/domains/store/orders/shared/order-arithmetic.guard.ts` — compuerta G3 apagada por ausencia de configuración; la fase I la acepta formalmente en vez de cablearla (F-017).
- `apps/backend/src/domains/store/orders/shared/financial-split-policy.ts` — `assertNoActiveFinancialSplit` corta el cobro cuando hay split activo; la proyección canónica de mesa debe respetarlo para no marcar pagada una cuenta partida a medias.
- `apps/backend/src/domains/store/orders/services/order-sse.service.ts` — stream de orden que la pantalla de detalle consume; si el cobro deja de ser el único evento, el refresco de mesa y el de orden deben acordar.
- `apps/backend/src/common/utils/tip.util.ts` — `resolveTip` aplica el porcentaje sobre el neto mientras el POS lo aplica sobre el bruto; la unificación de base de propina (F-008) vive aquí.

## Backend — pagos y cobro

- `apps/backend/src/domains/store/payments/payments.service.ts` — el carril POS completo: `applyPosPaymentToTableSession` recibe `items` nuevos de POS y `existingItems` de Mesas; el falso 422 `POS_TABLE_LINE_TAX_UNRESOLVABLE_001` sobre los primeros se retira según ADR-10. También contiene la proyección de pago, contra-entrega y el defecto de orden duplicada.
- `apps/backend/src/domains/store/payments/payments.controller.ts` — superficie HTTP del cobro POS; la verificación por carril (P1..P4) del plan entra por aquí con curl.
- `apps/backend/src/domains/store/payments/payments.module.ts` — registra el processor COD que nunca se invoca (F-014); si la fase I unifica el discriminador, el cableado se corrige aquí.
- `apps/backend/src/domains/store/payments/services/webhook-handler.service.ts` — tercer escritor de la proyección: hoy CIERRA la sesión y manda la mesa a `cleaning`, la divergencia más peligrosa que ADR-03 elimina.
- `apps/backend/src/domains/store/payments/services/payment-validator.service.ts` — `totalPaid >= grand_total` es warning, no error, y ningún carril `flow/pay` lo invoca (F-003, fase I).
- `apps/backend/src/domains/store/payments/services/payment-gateway.service.ts` — carril `POST /store/payments` que ignora `delivery_type` y no escribe desde `draft` (N9-04); el plan lo declara fuera de alcance pero lo inventaría para no tocarlo por accidente.
- `apps/backend/src/domains/store/payments/processors/cash-on-delivery/cash-on-delivery.processor.ts` — processor registrado y jamás invocado; es la evidencia de que el discriminador de F-014 quedó a medias.

## Backend — mesas y sesiones

- `apps/backend/src/domains/store/tables/table-sessions.service.ts` — dueño de `markSessionPaid` (primitiva idempotente sobre la que se construye la proyección canónica), `emitSessionPaid` (evento que nadie recibe, F-027), `transferSession` (precedente de mover una sesión sin romper el índice único parcial, ADR-07), `closeSession` (que hoy cierra sin exigir pago) y `createOpenSessionInTx` (que ocupa una mesa en `cleaning` sin avisar, F-020).
- `apps/backend/src/domains/store/tables/table-sessions.controller.ts` — whitelist default-deny del SSE de staff donde falta `session_paid`, y endpoint `items/:orderItemId/deliver` que ya delega en el seam de orden; la fase B abre el evento y la fase C confirma el destino.
- `apps/backend/src/domains/store/tables/tables.service.ts` — arma la fila del floor-map; hoy no expone `paid_at` ni el mesero, los dos datos que las fases B y ADR-04 tienen que hacer visibles.
- `apps/backend/src/domains/store/tables/tables.controller.ts` — superficie del floor-map y del detalle de mesa; los campos nuevos (`paid_at`, mesero) se declaran aquí antes de que el frontend los lea.
- `apps/backend/src/domains/store/tables/split-account-payment.service.ts` — segundo escritor de la proyección (marca y emite): es el bloque verbatim del que ADR-03 extrae la función canónica.
- `apps/backend/src/domains/store/tables/split-order.service.ts` — crea las cuentas financieras de la mesa; la proyección canónica debe decidir qué significa «pagada» cuando hay split, y este servicio define el saldo.
- `apps/backend/src/domains/store/tables/utils/split-allocation.util.ts` — kernel de reparto con la invariante `original === subtotal − descuento + impuesto + envío + propina`; es la aritmética contra la que se valida que la proyección no marque pagada una cuenta con saldo.
- `apps/backend/src/domains/store/tables/dto/table-session.dto.ts` — DTO de apertura de sesión; la reasignación de mesa (ADR-07) necesita aceptar `order_id`, que hoy no admite.
- `apps/backend/src/domains/store/tables/dto/cancel-order-item.dto.ts` — contrato de cancelación desde mesa; la fase D le añade el destino de insumos y unifica su vocabulario con el de cocina.
- `apps/backend/src/domains/ecommerce/tables/ecommerce-tables.controller.ts` — stream del comensal con su propio conjunto de eventos; si `session_paid` entra al carril de staff hay que decidir explícitamente si cruza o no al comensal.

## Backend — cocina y KDS

- `apps/backend/src/domains/store/kitchen-fire/kitchen-fire.service.ts` — `KITCHEN_TICKET_INCLUDE` (donde falta `delivery_type` para que la comanda distinga envío de llevar, F-030), la compuerta takeaway-only, el `updateMany` que entrega el ticket completo en vez de la línea, y `POST_CANCEL_REMAKE_TYPES`, cuyo vocabulario diverge del que escribe la cancelación y bloquea rehacer el plato (ADR-08).
- `apps/backend/src/domains/store/kds/sessions/kds-sessions.service.ts` — origen real de `KDS_STATION_LOCKED`: el turno de estación con heartbeat que hoy impide al mesero entregar (ADR-06); no se relaja, se le da mensaje accionable.
- `apps/backend/src/domains/store/kds/kds.service.ts` — vista del tablero que consume los mismos tickets; verifica que transportar `delivery_type` no altere ninguna de las seis reglas que gobierna `is_takeaway`.

## Backend — inventario y contabilidad

- `apps/backend/src/domains/store/inventory/shared/services/stock-level-manager.service.ts` — `updateStock` con `movement_type:'return'` es la única puerta por la que la reversa de BOM devuelve las hojas (ADR-08); también es la que hoy infla el stock devolviendo el plato vendido.
- `apps/backend/src/domains/store/inventory/shared/services/order-stock-commit.service.ts` — `commitOrderDelivery` y la bandera `inventory_committed`; la fase A necesita saber si una orden sin reserva puede lanzar `INV_STOCK_002` (hueco de conocimiento declarado en el hub).
- `apps/backend/src/domains/store/inventory/adjustments/inventory-adjustments.service.ts` — emite `inventory.adjusted`, el evento que ya produce el asiento de merma; «desechar» debe entrar por aquí en vez de inventar un asiento nuevo.
- `apps/backend/src/domains/store/accounting/account-mappings/account-mapping.service.ts` — declara la llave `inventory.adjusted.shrinkage` → PUC 5295, exactamente la cuenta que ADR-08 exige para la merma.
- `apps/backend/src/domains/store/accounting/auto-entries/auto-entry.service.ts` — construye el asiento inventario/merma según el signo del ajuste; es el generador que la fase D reutiliza.
- `apps/backend/src/domains/store/accounting/auto-entries/accounting-events.listener.ts` — escucha `inventory.adjusted` y dispara el auto-asiento; confirma que la merma del plato cancelado llegue a contabilidad sin código nuevo.

## Backend — direcciones y despacho

- `apps/backend/src/domains/store/addresses/addresses.service.ts` — la mina de F-024: crear una dirección `is_primary` sin cliente apaga los predeterminados de TODA la tienda; se desactiva en el mismo paso que levanta los gates de alias (ADR-05).
- `apps/backend/src/domains/store/addresses/addresses.controller.ts` — endpoint por el que el POS creará la dirección huérfana (`user_id = NULL`) de la venta con alias.
- `apps/backend/src/domains/store/addresses/dto/index.ts` — `CreateAddressDto` con `customer_id` opcional e `is_primary`; el contrato que hace posible la dirección sin cliente y el que hay que endurecer.
- `apps/backend/src/domains/store/dispatch-notes/dispatch-notes.service.ts` — gate `DSP_ORDER_DELIVERY_001` y consumidor por FK de la dirección de envío: es quien prueba que «solo snapshot» no sirve (ADR-05) y quien hoy bloquea la remisión de un pedido que nació `direct_delivery` (F-001).
- `apps/backend/src/domains/store/shipping/shipping-derivation.util.ts` — `deriveDeliveryType`, que manda todo método no clasificado al cajón `other` (F-019); la fase E decide si `custom` se mapea o se documenta.
- `apps/backend/src/domains/store/dispatch-routes/dispatch-routes.service.ts` — segundo consumidor por FK de la dirección (parada de ruta y mapa); confirma el requisito de persistir FK y snapshot a la vez.

## Backend — fiscal y ajustes de tienda

- `apps/backend/src/domains/store/taxes/taxes.service.ts` — `has_tax_assignment` es `assignments.length > 0` sin historial: el dato que no sostiene el mensaje que hoy se le muestra al comerciante (F-021).
- `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts` — declara `settings.pos.tax_line_gate`; H.2 lo marca legacy/inerto para aceptar JSON histórico sin gobernar el cobro.
- `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts` — H.2 retira `pos.tax_line_gate` de los defaults nuevos sin borrar JSON histórico.
- `apps/backend/src/domains/store/settings/dto/settings-schemas.dto.ts` — H.2 conserva la validación de la clave legacy para que un guardado de settings existente no falle.
- `apps/backend/src/domains/store/invoicing/pos/pos-sale-completed.listener.ts` — la venta sin documento fiscal sigue siendo un `logger.warn` sin cola ni reintento (F-018, fase I).
- `apps/backend/src/domains/store/invoicing/pos/pos-fiscal-emission.service.ts` — deja la constancia persistente en `fiscal_operation_events` pero sin superficie agregada; define qué falta para cerrar o aceptar F-018.
- `apps/backend/src/domains/store/invoicing/invoicing.service.ts` — si una línea desaparece de una orden ya facturada, la factura emitida deja de corresponder: es el consumidor que justifica bloquear la cancelación post-cobro (ADR-02).

## Esquema Prisma

- `apps/backend/prisma/schema.prisma` — fuente de verdad de las ocho decisiones sin DDL: `orders.customer_alias` con el CHECK `orders_customer_xor_alias`, el par `shipping_address_id`/`shipping_address_snapshot`, `addresses.user_id` nullable, `table_sessions.opened_by` con su relación `opener`, `table_sessions.order_id` NO único y el índice parcial `table_sessions_one_open_per_table`. Cada paso verifica aquí antes de proponer migración.

## Frontend — POS

- `apps/frontend/src/app/private/modules/store/pos/pos.component.ts` — declara `editingOrderId` (el estado que distingue reabrir de crear) y monta `<app-pos-customer-modal>` ANTES del checkout shell, layaway y order-payment: el orden del DOM que deja el modal de cliente por debajo (F-025).
- `apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/pos-checkout-shell.component.ts` — estampa `pickup` para «llevar» contra la decisión de ADR-01, y hospeda `aliasBlockedByDelivery`, el primero de los tres gates que apagan el envío con alias (F-023).
- `apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/pos-checkout-shell.component.html` — plantilla del shell; la reordenación de modales de F-025 se verifica contra ella.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/steps/pos-shipping-step.component.ts` — devuelve contexto nulo cuando no hay método (F-001), calcula `is_primary: !customer.addresses?.length` que sin cliente evalúa a `true` (la mina de F-024), y aloja el segundo gate de alias.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/steps/pos-payment-step.component.ts` — paso donde se dispara el cobro y donde el carril de crédito pide cliente sin cerrar el shell; superficie del reenrutado de F-025.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/steps/pos-entrega-step.component.ts` — elección de modo de entrega; es la UI que deja de ofrecer promesa de recogida cuando «llevar» pasa a `direct_delivery` (ADR-01).
- `apps/frontend/src/app/private/modules/store/pos/services/pos-payment.service.ts` — POS «Consumir en mesa» envía `items` con `table_id`/`table_session_id` durante el cobro; H.3 fija ese payload frente a Mesas. También gobierna delivery, alias y contra-entrega.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-cart.service.ts` — `loadFromOrder` y la identidad de línea del carrito, gobernada por `is_takeaway`: la fase C no puede tocar ese booleano sin romper aquí.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-order.service.ts` — crea el borrador y lo actualiza; es el lado del cliente del defecto que produce una segunda orden al reabrir y cobrar.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-restaurant-integration.service.ts` — puente POS↔mesa: sabe qué sesión está activa y es quien debe enterarse de que el cobro proyectó sobre la mesa.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-customer-modal.component.ts` — el modal que queda tapado; su posición en el árbol es el fix de F-025.
- `apps/frontend/src/app/private/modules/store/pos/components/layaway-config-modal/layaway-config-modal.component.ts` — segundo modal que tapa al de cliente por empate de z-index.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-open-table-modal.component.ts` — deja clicable a propósito la mesa en `cleaning`; F-020 añade aviso, no bloqueo.
- `apps/frontend/src/app/private/modules/store/pos/models/cart.model.ts` — define `linkedOrderId` y el estado del carrito adoptado, el discriminador entre cobrar la orden existente y crear una nueva.
- `apps/frontend/src/app/private/modules/store/pos/models/shipping.model.ts` — forma del contexto de envío que se pierde y se restaura al reabrir; la fase F le añade el alias.

## Frontend — órdenes

- `apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.ts` — pantalla donde una orden `dine_in` no se puede cobrar, donde el `confirm()` nativo decide el destino de los insumos (ADR-08 lo reemplaza por modal) y donde `pickup`/`dine_in` se etiquetan mal (F-011).
- `apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.html` — ya pinta `session.opener`: es el precedente visual que ADR-04 replica en la mesa.
- `apps/frontend/src/app/private/modules/store/orders/interfaces/order.interface.ts` — `DeliveryType` sin `dine_in`, causa de que un QR de mesa se muestre como «Entrega directa» (F-011).
- `apps/frontend/src/app/private/modules/store/orders/services/orders.service.ts` — cliente HTTP del flujo de orden: cancelar línea, entregar, cobrar; todos los contratos que cambian en las fases C, D y E pasan por aquí.
- `apps/frontend/src/app/private/modules/store/orders/services/store-orders.service.ts` — segundo cliente de órdenes del panel; se revisa para que el cambio de contrato no deje un consumidor desincronizado.
- `apps/frontend/src/app/private/modules/store/orders/components/order-payment-modal/order-payment-modal.component.ts` — modal de cobro desde el detalle (carril P3, el que hoy no proyecta sobre la mesa) y tercer modal que tapa al de cliente.
- `apps/frontend/src/app/private/modules/store/orders/services/order-detail-sse.service.ts` — stream del detalle de orden; referencia de cómo se suscribe una pantalla a SSE, que la página de mesa aún no hace.

## Frontend — mesas

- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/pages/table-session-page/table-session-page.component.ts` — bifurca la entrega: el preparado para llevar sigue yendo al endpoint de cocina con turno y compuerta takeaway-only (ADR-06 lo reenruta); además solo inyecta el SSE de KDS, así que no puede enterarse de `session_paid`.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/pages/table-session-page/table-session-page.component.html` — plantilla de la cuenta abierta: es donde se pinta el estado «pagada» y donde debe aparecer el mesero (ADR-04).
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/pages/tables-floor-page/tables-floor-page.component.ts` — mapa de salón que debe reflejar el cobro en tiempo real y mostrar quién abrió cada mesa.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/components/table-floor-map/table-floor-map.component.ts` — pinta el tile de cada mesa; consumidor de `paid_at` y del mesero, ninguno de los dos disponible hoy.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/components/transfer-table-modal/transfer-table-modal.component.ts` — UI del traslado existente; punto de entrada natural de la reasignación de ADR-07 y precedente de su validación de elegibilidad.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/interfaces/table.interface.ts` — no declara el mesero aunque el backend ya lo proyecta (F-028), y define la forma que la fase B amplía con el estado de pago.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/services/tables.service.ts` — módulo Mesas: `addItems` escribe antes del cobro; `payTableSession` usa el mismo `/payments/pos` sin `items`. H.3 verifica ambos contratos; también contiene entrega y reasignación.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/services/admin-tables-sse.service.ts` — unión `AdminTablesEvent` sin `session_paid`; la fase B la amplía y suscribe la página de mesa.

## Frontend — KDS

- `apps/frontend/src/app/private/modules/store/restaurant-ops/kds/interfaces/kitchen-ticket.interface.ts` — el ticket solo expone `is_takeaway`; la fase C le añade `delivery_type` para la etiqueta sin tocar el booleano (F-030).
- `apps/frontend/src/app/private/modules/store/restaurant-ops/kds/components/kds-ticket-card/kds-ticket-card.component.html` — pinta el badge que hoy confunde domicilio con llevar.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/kds/components/kds-ticket-card/kds-ticket-card.component.ts` — lógica del badge y de las acciones del ticket; verifica que la etiqueta nueva no cambie ninguna regla.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/kds/services/kitchen-tickets.service.ts` — `markDelivered(ticketId)` es la llamada que la mesa deja de usar en ADR-06; se conserva intacta para el tablero.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/kds/pages/kds-board-page/kds-board-page.component.ts` — consumidor legítimo del endpoint de cocina; garantiza que el reenrutado de la mesa no le quite funcionalidad.

## Frontend — ajustes, compartidos y contratos de UI

- `apps/frontend/src/app/private/modules/store/settings/general/components/pos-settings-form/pos-settings-form.component.ts` — expone opciones POS; H.2 verifica que **no** añada un control `tax_line_gate` para esquivar el falso 422.
- `apps/frontend/src/app/private/modules/store/settings/general/components/pos-settings-form/pos-settings-form.component.html` — plantilla POS: no debe ofrecer un interruptor fiscal de emergencia como regla permanente.
- `apps/frontend/src/app/core/models/store-settings.interface.ts` — modelo FE de ajustes: H.2 no añade `tax_line_gate` como configuración editable.
- `apps/frontend/src/app/core/utils/error-messages.ts` — mensajes tipados; H.2 evita un CTA «asignar impuesto» para una venta taxless legítima. C/KDS siguen necesitando sus mapeos.
- `apps/frontend/src/app/core/utils/parse-api-error.ts` — traductor de errores del backend; es el punto donde los códigos nuevos se leen por código y no por texto.
- `apps/frontend/src/app/shared/components/modal/modal.component.ts` — impone `z-[9999]` a todos los modales sin override: la razón de que el orden del DOM decida quién tapa a quién (F-025). El plan no lo migra a CDK, solo lo entiende.
- `apps/frontend/src/app/shared/components/payment-collector/payment-collector.component.ts` — emite `requestCustomer` sin cerrar el shell: el disparador concreto del modal tapado.
- `apps/frontend/src/app/private/modules/store/settings/shipping/services/shipping-methods.service.ts` — una de las cuatro etiquetas divergentes de `pickup` que la fase E unifica (F-011).
- `apps/frontend/src/app/private/modules/store/settings/shipping/pages/method-detail/method-detail.component.ts` — crea métodos `custom`, origen real del `delivery_type = 'other'` que F-019 obliga a documentar o mapear.
- `apps/backend/src/domains/ecommerce/checkout/checkout.service.ts` — segundo escritor de `is_takeaway` y de `delivery_type` derivado; cualquier cambio de semántica de entrega debe contrastarse contra este carril antes de tocar el POS.

## Contratos compartidos

- `apps/backend/src/common/errors/error-codes.ts` — catálogo único de códigos tipados: aquí se declaran los códigos nuevos de la cancelación bloqueada (ADR-02) y de la reasignación (ADR-07), y aquí se comprueba que `KITCHEN_TICKET_NOT_TAKEAWAY` todavía no está registrado.
- `apps/backend/src/common/errors/vendix-http.exception.ts` — patrón de excepción tipada que todo rechazo nuevo debe usar; los tests de rechazo fijan el `errorCode`, no la clase.

## Tests y seeds

- `apps/backend/src/domains/store/orders/order-flow/order-flow.service.spec.ts` — fija hoy como decisión el vacío de reversa no-efectivo (F-005) y cubre el flujo de cancelación; cada paso de las fases A y D deja aquí un test que falla antes del fix.
- `apps/backend/src/domains/store/orders/order-flow/order-cancellation-policy.util.spec.ts` — suite de la política de cancelación; el punto barato donde probar la derivación «orden cobrada» de ADR-02.
- `apps/backend/src/domains/store/payments/payments.service.spec.ts` — cubre el carril POS y la compuerta fiscal; es donde se prueba que la proyección canónica no cambia lo que ya funcionaba.
- `apps/backend/src/domains/store/payments/payment-validator.service.spec.ts` — su caso `:150` fija el fully-paid como warning esperado; si la fase I cambia la política, este spec cambia con ella.
- `apps/backend/src/domains/store/tables/table-sessions.service.spec.ts` — suite de sesiones: apertura, cierre, traslado; la reasignación de ADR-07 se prueba contra sus invariantes.
- `apps/backend/src/domains/store/tables/split-account-payment.service.spec.ts` — prueba el segundo escritor de la proyección; su verde es la red que hace seguro extraer la función canónica.
- `apps/backend/src/domains/store/tables/tables.service.spec.ts` — cubre la fila del floor-map, que gana `paid_at` y mesero.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-cart.service.spec.ts` — cubre la restauración del contexto de envío al reabrir; la fase F le añade el alias.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/pos-checkout-shell.component.spec.ts` — fija el comportamiento del shell que las fases E y F cambian.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/steps/pos-shipping-step.component.spec.ts` — fija el paso de envío, incluidos los gates de alias que la fase F levanta.
- `apps/backend/prisma/seeds/restaurant-e2e.seed.ts` — crea la tienda, los platos con receta y los usuarios `mesero.e2e@roku.test` / `cocina.e2e@roku.test`: el dataset representativo obligatorio del dry-run de mesa y cocina.
- `apps/backend/prisma/seed.ts` — runner que orquesta los seeds; el plan lo usa para reconstruir el dataset, nunca base vacía.
- `scripts/buildcheck.sh` — verificación de compilación y tests sin levantar servidor; compuerta de cada paso antes de pasar al siguiente.
