# Reusable Assets

<!-- [MANDATORY] From Reuse Discovery — one line per asset: `path` — what it provides, or `none — <reason>` if empty. -->
<!-- Premisa del plan: casi nada hay que inventar. Cada activo de abajo fue abierto y verificado en el árbol de trabajo (2026-09-20). -->

## Cancelación de plato — reversa de insumos y merma (fase D, ADR-08)

- `apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts` — la reversa de BOM CORRECTA ya existe dentro de `cancelOrder` (rama `kitchenDisposition === 'reuse'`, ~`:3209-3245`): relee `inventory_transactions` del ítem con `quantity_change < 0` y devuelve cada consumo real con `StockLevelManager.updateStock` (`movement_type:'return'`, sin `order_item_id` por la FK `Restrict`). ADR-08 la extrae a un helper y la invoca desde `cancelDeliveredOrderItem` en vez de escribir una nueva; el bloque `waste` de la misma rama es el default seguro que no toca stock. **Salvedad verificada:** el código existe pero NO está probado — `kitchenDisposition` tiene cero apariciones en cualquier `.spec.ts` del repo, así que la fase D escribe el primer test de esta rama antes de reutilizarla.
- `apps/backend/src/domains/store/orders/order-flow/order-cancellation-policy.util.ts` — util puro con `SETTLED_PAYMENT_STATES = succeeded|captured|partially_refunded|refunded` y `getCancellationBlocker`: es exactamente la derivación de «orden cobrada» que ADR-02 necesita para reemplazar el guard que lee `orders.payment_status` (columna inexistente). Tiene spec propio, así que el paso de la fase A prueba la política sin montar servicio.
- `apps/backend/src/domains/store/accounting/account-mappings/account-mapping.service.ts` — la llave de mapeo `inventory.adjusted.shrinkage` ya apunta a PUC `5295` («Faltantes de Inventario»). El paso de merma no elige cuenta ni crea llave: reusa la que el contador ya tiene configurada y overrideable por organización.
- `apps/backend/src/domains/store/accounting/auto-entries/auto-entry.service.ts` — ya construye el asiento inventario↔merma según el signo del ajuste, con débito/crédito resueltos por llave de mapeo. «Desechar» reutiliza este generador.
- `apps/backend/src/domains/store/accounting/auto-entries/accounting-events.listener.ts` — `@OnEvent('inventory.adjusted')` ya dispara el auto-asiento post-commit. El paso de merma emite el evento existente; no cablea un listener nuevo.
- `apps/backend/src/domains/store/inventory/adjustments/inventory-adjustments.service.ts` — emisor canónico de `inventory.adjusted` con su ajuste persistido; es la puerta por la que la merma entra a contabilidad con trazabilidad, en vez de un asiento a mano.
- `apps/backend/src/domains/store/kitchen-fire/kitchen-fire.service.ts` — `POST_CANCEL_REMAKE_TYPES` (`after_fire_reused` / `after_fire_waste`) ya define el vocabulario que habilita rehacer el plato; la fase D unifica hacia él en vez de inventar valores nuevos de `cancellation_type`.

## Entrega del mesero — seam por ítem (fase C, ADR-06)

- `apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts` — `deliverOrderItem(orderId, orderItemId)` (`:1808`) ya es el seam correcto: opera POR ÍTEM, es idempotente sobre `delivered_at`, NO exige turno de estación, no mira `is_takeaway` y sincroniza hacia `kitchen_ticket_items` con `syncKitchenOnOrderItemDelivered` (solo la fila del ítem, por PK, y cierra el ticket cuando todas quedan terminales). ADR-06 es un cambio de destino, no código nuevo.
- `apps/backend/src/domains/store/tables/table-sessions.service.ts` — `markItemDelivered` (`:2100`) ya envuelve ese seam con el único check que el seam no puede hacer (que el ítem pertenezca a ESTA cuenta) y devuelve la sesión recargada. El endpoint de mesa ya está construido y probado.
- `apps/backend/src/domains/store/tables/table-sessions.controller.ts` — `PATCH /store/table-sessions/:id/items/:orderItemId/deliver` (`:305`) ya existe con su permiso `store:table_sessions:update`: la fase C no añade ruta ni permiso.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/pages/table-session-page/table-session-page.component.ts` — el método privado `deliverTableSessionItem` YA implementa la llamada al seam de mesa con su propia señal de spinner (`deliveringItemId`) y su toast. El paso de ADR-06 solo cambia la condición de la bifurcación de `markDelivered` para que el preparado-para-llevar también caiga en esta rama; la rama destino ya está escrita.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/services/tables.service.ts` — `markItemDelivered(sessionId, orderItemId)` ya es el cliente HTTP del seam de mesa, documentado y con manejo de error propio.

## Proyección del cobro sobre la mesa (fase B, ADR-03)

- `apps/backend/src/domains/store/tables/split-account-payment.service.ts` — PRIMER bloque modelo: marca la sesión pagada dentro de la transacción del pago (`:547-552`) y emite `session_paid` post-commit (`:572`). Es la semántica que el dueño eligió (pagada sin cerrar) y el código del que se extrae la función canónica.
- `apps/backend/src/domains/store/payments/payments.service.ts` — SEGUNDO bloque modelo: `applyPosPaymentToTableSession` marca `paid_at` dentro del `$transaction` del pago y emite el SSE después del commit (`:1983`), con el guard `POS_TABLE_SESSION_ALREADY_CHARGED` que protege el doble cobro. Ambos bloques funcionan hoy: la extracción es refactor con dos llamadores probados, no diseño nuevo.
- `apps/backend/src/domains/store/tables/table-sessions.service.ts` — `markSessionPaid(sessionId, paymentId, tx?)` (`:1542`) ya es la primitiva idempotente que la proyección canónica envuelve: no reescribe `paid_at` si ya existe, acepta `tx` opcional para correr dentro de la transacción del pago y deja la mesa `occupied`. Y `emitSessionPaid` (`:1617-1654`) ya publica el evento canónico en el subject por tienda.
- `apps/backend/src/domains/store/orders/order-flow/order-lifecycle-lock.util.ts` — `lockOrderLifecycle(tx, orderId, storeId)` ya hace `SELECT … FOR UPDATE` sobre la orden y sus pagos con filtro de tienda. La proyección canónica toma este lock; no se escribe un mecanismo de serialización nuevo.
- `apps/backend/src/domains/store/orders/shared/financial-split-policy.ts` — `assertNoActiveFinancialSplit` ya frena el cobro cuando hay un split activo; la proyección lo invoca para no marcar pagada una cuenta partida a medias.
- `apps/backend/src/domains/store/tables/utils/split-allocation.util.ts` — el kernel de reparto ya impone `original === subtotal − descuento + impuesto + envío + propina` y rechaza la fuente que no cuadre; es la aritmética de referencia para decidir cuándo una cuenta con split está realmente saldada.

## Evento SSE de cuenta pagada y stream de staff (fase B, F-027)

- `apps/backend/src/domains/store/tables/table-sessions.service.ts` — `emitSessionPaid` ya EXISTE y ya se invoca desde los dos carriles que proyectan (POS y split). No hay que emitir nada nuevo: hay que dejarlo pasar.
- `apps/backend/src/domains/store/tables/table-sessions.controller.ts` — `STAFF_EVENT_WHITELIST` (`:51-82`) ya distribuye `session_closed`, `session_opened`, `session_moved`, `table_status_changed`, `payment.confirmed`, `table_payment_confirmed`, `table_created/updated/deleted` y todo `kitchen.*` por el stream de staff. El cambio es UNA línea (`session_paid`) dentro de un predicado ya construido y probado.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/services/admin-tables-sse.service.ts` — el servicio SSE de staff ya está escrito: unión `AdminTablesEvent` (`:109`), parseo, `applyEvent`, `handleFloorTransition` y señal `lastEvent`. Añadir un miembro a la unión y su rama de aplicación reutiliza toda la maquinaria de reconexión y reconciliación.
- `apps/frontend/src/app/private/modules/store/orders/services/order-detail-sse.service.ts` — precedente de cómo una página de detalle se suscribe a SSE con backoff; la página de mesa lo copia en vez de inventar su propio cliente.
- `apps/backend/src/domains/ecommerce/tables/ecommerce-tables.controller.ts` — `DINER_LIFECYCLE_EVENTS` (`:577`) es el equivalente para el comensal: el precedente de cómo se decide explícitamente qué evento cruza a qué audiencia.

## Reasignación de mesa (fase G, ADR-07)

- `apps/backend/src/domains/store/tables/table-sessions.service.ts` — `transferSession` (`:1229-1400`) es el precedente completo: mueve una sesión entre mesas conservando `opened_by`, re-estampa `kitchen_tickets.table_id`, respeta el índice único parcial `table_sessions_one_open_per_table` y emite `session_moved`. La reasignación reutiliza su validación de elegibilidad, su re-estampado de cocina y su evento. Y `createOpenSessionInTx` (`:363`) ya es la apertura transaccional parametrizable que la sesión nueva necesita.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/components/transfer-table-modal/transfer-table-modal.component.ts` — UI de traslado ya construida (elección de mesa destino, validación, confirmación); la reasignación se cuelga de esta superficie en vez de crear un modal nuevo.
- `apps/backend/prisma/schema.prisma` — el índice único parcial `table_sessions_one_open_per_table` y la NO-unicidad de `table_sessions.order_id` son el activo estructural que hace la decisión viable sin migración: la base impide el peor caso por construcción.

## Mesero visible en la mesa (ADR-04, F-028)

- `apps/backend/src/domains/store/orders/orders.service.ts` — el `include` de `table_sessions` ya hidrata la relación `opener` (`{id, first_name, last_name}`, `:1061-1085`). La proyección del mesero en mesa copia ese select exacto; el nombre ya se resuelve en otro lado del mismo esquema.
- `apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.html` — ya pinta `session.opener.first_name` (`:520-525`): el precedente visual y de copy, listo para replicar en la mesa.
- `apps/backend/src/domains/store/tables/table-sessions.service.ts` — `findOne` ya proyecta un objeto `table.waiter` con la forma `{id, first_name, last_name}` (`~:1950`), aunque hoy se alimenta del pivote `table_waiters`, no de `opened_by`. La FORMA del contrato ya existe; ADR-04 cambia la fuente, no el shape.

## Modal tapado por orden del DOM (F-025)

- `apps/frontend/src/app/private/modules/store/inventory/pop/pop.component.ts` — el precedente ya resuelto en este repo: el template documenta el bug (`~:207-213`, «app-modal monta fixed inset-0 z-[9999], todos los modales comparten z-index, y gana quien aparece MÁS TARDE en el template») y lo arregla reordenando. El fix de POS es el mismo movimiento, con el comentario ya redactado.
- `apps/frontend/src/app/shared/components/dialog/dialog.service.ts` — `DialogService` crea modales por `createComponent` fuera del árbol del componente, así que no sufre el empate de z-index; es la vía ya disponible para el modal de destino de insumos de la fase D (`ConfirmData` con `confirmText`/`cancelText`/`confirmVariant` ya soporta dos opciones etiquetadas).

## Envío con alias y dirección (fase F, ADR-05)

- `apps/frontend/src/app/shared/components/address-form-fields/address-form-fields.component.ts` — componente compartido de campos de dirección que YA embebe el selector de mapa y YA está importado por `pos-shipping-step.component.ts`. La fase F no integra nada: levanta gates sobre una UI que ya está montada en el paso exacto que toca.
- `apps/frontend/src/app/private/modules/ecommerce/components/address-map-picker/address-map-picker.component.ts` — selector de mapa (MapLibre) con geocodificación, consumido por el componente anterior y por el checkout ecommerce; el mismo control para la dirección de la venta con alias.
- `apps/frontend/src/app/private/modules/store/orders/components/shipping-address-modal/shipping-address-modal.component.ts` — modal de dirección de envío del detalle de orden, ya construido sobre el componente compartido; referencia de cómo se captura una dirección fuera del POS.
- `apps/backend/src/domains/store/addresses/dto/index.ts` — `CreateAddressDto` ya acepta `customer_id` OPCIONAL: el contrato que hace posible la dirección huérfana sin cambiar el DTO. La premisa que apagó el carril («no hay forma de atar un envío sin `customer_id`») es falsa contra este archivo.
- `apps/backend/prisma/schema.prisma` — `orders.customer_alias` + CHECK `orders_customer_xor_alias`, `addresses.user_id` nullable y el par `shipping_address_id` / `shipping_address_snapshot` ya existen: ADR-05 se eligió precisamente porque no requiere DDL.
- `apps/backend/src/domains/store/payments/payments.service.ts` — el gate `POS_CUSTOMER_REQUIRED_001` ya EXIME al carril alias (`:855`): el backend ya sabe vender por alias, solo falta que el frontend deje.

## Errores tipados y mensajes accionables (transversal)

- `apps/backend/src/common/errors/error-codes.ts` — catálogo único con HTTP real por código; `POS_TABLE_SESSION_ALREADY_CHARGED`, `ORD_SHIP_CHARGE_001`, `KDS_STATION_LOCKED`, `ITEM_ALREADY_DELIVERED`, `ORDER_ITEM_NOT_DELIVERABLE`, `POS_TABLE_LINE_TAX_UNRESOLVABLE_001`, `ORD_EDIT_NOT_ALLOWED_001`, `DSP_ORDER_DELIVERY_001` y `ORD_LINE_TOTAL_MISMATCH_001` ya están registrados. Los códigos nuevos se añaden a este registro, no a un enum local.
- `apps/backend/src/common/errors/vendix-http.exception.ts` — `VendixHttpException(ErrorCodes.X, devMessage?, meta?)` es el patrón de rechazo tipado ya usado por todos los guards del dominio; ADR-02 y ADR-07 lo reutilizan tal cual.
- `apps/frontend/src/app/core/utils/parse-api-error.ts` — `parseApiError` ya extrae el código del error del backend y ya lo usa la página de mesa (`onKitchenMutationError`); mapear los códigos nuevos es añadir filas, no cablear un traductor.
- `apps/frontend/src/app/core/utils/error-messages.ts` — mapa código→mensaje accionable ya existente; la fase H y la fase C añaden entradas a una tabla que ya se consulta.

## Ajustes de tienda y válvula fiscal (fase H)

- `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts` — `settings.pos.tax_line_gate` (`block`/`warn`/`off`) existe como compatibilidad histórica. ADR-10 hace innecesario su gate: H.2 conserva la aceptación del JSON antiguo, retira la lectura en cobro y no expone un control nuevo.
- `apps/frontend/src/app/private/modules/store/settings/general/components/pos-settings-form/pos-settings-form.component.ts` — el formulario ya expone `allow_anonymous_sales` y `allow_alias_sales` con toda la maquinaria de guardado de settings; el control nuevo se suma a un formulario existente.

## Dataset representativo y verificación (transversal)

- `apps/backend/prisma/seeds/restaurant-e2e.seed.ts` — seed idempotente que crea tienda restaurante, platos preparados con receta/BOM y los usuarios `mesero.e2e@roku.test` y `cocina.e2e@roku.test` con sus roles `mesero`/`cocina` y sus claves `panel_ui`. Es el dry-run sobre dataset representativo que exige el hub (nunca base vacía): media docena de los defectos solo aparecen con sesión preexistente o ticket mixto.
- `apps/backend/prisma/seed.ts` — runner de seeds que orquesta dependencias (organizaciones → usuarios → productos → órdenes); reconstruye el entorno de prueba sin SQL manual.
- `scripts/buildcheck.sh` — verificación sin servidor: `buildcheck:be`, `buildcheck:fe`, `buildcheck:test`, `buildcheck:reap`. Es la compuerta por paso; el hub ya fija la regla de correr los tests con `--runInBand` porque el runner imprime FAIL y sale 0 al quedarse sin memoria.
- `skills/how-to-test/SKILL.md` — metodología de verificación obligatoria del repo: curl para contratos de API y Playwright MCP para los cinco recorridos E2E del hub, contra el vhost local `vendix.com` y con credenciales de seed. El plan no define método propio.
- `skills/how-to-critical-plan/assets/cp-lint.sh` — linter del bundle (estructura, vocabularios, registries); compuerta de cierre del plan, ya escrito. Junto a `cp-ledger.sh` (ledger e índice de fragmentos) y `cp-context.sh`.
- `docs/critical-plans/CP-pos-order-flows-audit` — bundle de auditoría en solo-lectura: las 30 fichas `F-001..F-030` con archivo:línea son la evidencia de partida de cada paso; se referencian por ID y no se reescriben aquí.
- `docs/pos-order-flows-user-stories.html` — artefacto de historias AS-IS/TO-BE del flujo POS→orden→pago→mesa; base narrativa para los recorridos E2E, ya publicado.

## Salvedad sobre activos sin commitear

Tres de los activos de arriba son trabajo EN VUELO de otra sesión y aparecen como `??` en `git status`: `apps/backend/src/domains/store/orders/order-flow/order-cancellation-policy.util.ts`, `apps/backend/src/domains/store/orders/order-flow/order-lifecycle-lock.util.ts` y `apps/backend/src/domains/store/orders/shared/financial-split-policy.ts`. Existen en el árbol y están verificados, pero si ese trabajo se pierde antes de commitearse, las fases A, B y G se quedan sin su derivación de «orden cobrada», sin su lock de ciclo de vida y sin su guard de split. El primer paso que dependa de ellos confirma que siguen presentes.

## Áreas sin activo reutilizable

- Cola de reintento fiscal (F-018) — none: `invoice_retry_queue.invoice_id` es NOT NULL y una venta sin factura no tiene id que encolar; no existe cola por `order_id` ni superficie agregada de «ventas sin documento». Si la fase I decide cerrarlo, se escribe desde cero.
- Job G2 de vigilancia de la invariante `total_price = unit_price × line_units` (F-017) — none: el único `@Cron` de invariantes del repo audita OTRO predicado (bruto por peso, ADR-11 de `CP-pos-exclusive-tax-double-charge`) y es anterior a esta auditoría. Por eso la fase I acepta el hallazgo en vez de cablear la compuerta.
- Artefacto de reembolso al cancelar (F-005) — none: no hay ni un `refunds.create` en `order-flow.service.ts`; solo existe el egreso de caja en efectivo (`registerCancelCashOut`), que es reutilizable como patrón de escritura post-commit pero no cubre tarjeta, transferencia ni Wompi.
- Aviso de mesa en limpieza (F-020) — none: `createOpenSessionInTx` es un setter de `tables.status`, no una transición, así que no existe ningún `previous_table_status` que propagar; hay que añadirlo al contrato de `CreatedOpenSession` y a sus tres llamadores.
- Registro del código `KITCHEN_TICKET_NOT_TAKEAWAY` — none: vive inline como `KITCHEN_TICKET_NOT_TAKEAWAY_ENTRY` en `kitchen-fire.service.ts` y NO está en `error-codes.ts`, así que darle mensaje accionable exige registrarlo primero.
