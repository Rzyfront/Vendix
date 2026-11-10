# Flujo de producción (QUI-988 a QUI-1002)

Objetivo: implementar uno a uno los 15 tickets consolidados el 2026-11-09 (repostería/restaurante: producción, pedidos programados, adiciones, KDS). Rama `feat/flujo-produccion` (worktree `../Vendix-produccion`, base `origin/develop` 5ba3d56c6), un commit por ticket. Entrega: commits locales; push/PR solo si Rafael lo pide. Runner backend: `cd apps/backend && npx jest --runInBand <spec>` (un spec por vez, nunca dos jest a la vez). Frontend: sin `ng test`; verificación por revisión de diff (UI en vhost pendiente: el vhost sirve el checkout principal).

## Specs

Cada S# es un ticket de Linear. El texto literal completo (historia, pasos, criterios, citas de Rafael y notas técnicas) está en Linear. Los criterios se copian aquí sin resumir.

### S1 — QUI-988 · FIX/ Insumo repetido en la receta descuenta stock una sola vez [api]

Ticket: https://linear.app/quickss/issue/QUI-988

- [ ] El stock baja la suma de todos los movimientos del insumo (240 g de azúcar y 200 ml de leche en el ejemplo).
- [ ] Tras la venta, los movimientos y el stock de cada insumo cuadran.
- [ ] Un plato sin insumos repetidos sigue descontando igual que hoy.

### S2 — QUI-989 · FIX/ Pedido programado se manda a cocina y gasta la receta al cobrar [api]

Ticket: https://linear.app/quickss/issue/QUI-989

- [ ] Al cobrar un pedido programado no se manda a cocina ni se mueve ningún insumo.
- [ ] Un plato programado no va a cocina al cobrar. Si es producible, va a Producción o reserva stock, según elija el cajero. Si no es producible, se manda a KDS el día del pedido con "Enviar a cocina" desde la agenda, y la receta y las adiciones se descuentan en ese momento.
- [ ] Las ventas no programadas siguen la matriz de [QUI-999](https://linear.app/quickss/issue/QUI-999/feat-linea-divisoria-entre-kds-y-produccion-visible-en-la-orden): los platos sin "Producido en lote" van a cocina al cobrar, como hoy.

### S3 — QUI-990 · FIX/ La venta no usa el stock de preparaciones hechas por lote [api]

Ticket: https://linear.app/quickss/issue/QUI-990

- [ ] El Bizcocho baja de 4 a 3 y sus insumos no se mueven.
- [ ] Las preparaciones que no se producen por lote siguen descontando su receta, como hoy.
- [ ] Sin stock de la preparación por lote, la venta genera su producción: se hace como parte del pedido y sus insumos se descuentan donde se consuma la línea (al vender si sale del stock, al mandar a cocina o al iniciar producción). Solo bloquea si faltan insumos (regla sin sobreventa).
- [ ] Con stock parcial, usa lo que hay y produce lo que falta (inferido).

### S4 — QUI-1001 · FEAT/ Adiciones y pedidos programados solo para restaurante [api][admin]

Ticket: https://linear.app/quickss/issue/QUI-1001

- [ ] En tiendas que no son restaurante no se ven: el submódulo y la acción Adiciones, el selector de adiciones del POS y del ecommerce, Pedidos programados (agenda, lista de producción y ajustes), Producción ni KDS.
- [ ] La URL directa de esos módulos redirige igual que cualquier módulo oculto.
- [ ] En tiendas restaurante todo sigue visible como hoy.
- [ ] Esconder no borra datos.
- [ ] Antes de desplegar se cuenta cuántas tiendas de otras industrias usan hoy adiciones o pedidos programados, y se avisa si hay alguna.

### S5 — QUI-992 · FIX/ Cobro bloqueado con "Configure la caja para continuar" tras reingresar [admin]

Ticket: https://linear.app/quickss/issue/QUI-992

- [ ] Con una caja abierta, el cobro funciona después de reingresar.
- [ ] Si falta elegir la caja, el POS ofrece elegirla en pantalla.

### S6 — QUI-998 · FIX/ Recargar tras guardar configuración de usuario abre el panel de organización [admin]

Ticket: https://linear.app/quickss/issue/QUI-998

- [ ] Después de guardar la configuración y recargar, sigo en la tienda.
- [ ] El módulo activado aparece en el menú.
- [ ] No aparecen errores 403.

### S7 — QUI-991 · FIX/ Agenda y lista de producción no muestran dedicatoria, cliente ni productos [admin]

Ticket: https://linear.app/quickss/issue/QUI-991

- [ ] El detalle del pedido muestra el nombre de la clienta.
- [ ] El detalle lista los productos con sus adiciones y la nota de cada línea.
- [ ] La lista de producción muestra la nota (dedicatoria) de cada línea.
- [ ] Las cantidades salen en español ("1 und").

### S8 — QUI-997 · FIX/ Detalles de UI en adiciones, producción, POS y recibo [admin]

Ticket: https://linear.app/quickss/issue/QUI-997

- [ ] El recibo muestra la hora en 24 horas o con a. m./p. m.
- [ ] Cada página tiene su título propio.
- [ ] Producción muestra la unidad real y plurales correctos.
- [ ] "Completadas (mes)" cuenta solo las del mes en curso.
- [ ] El selector de componentes filtra por los tipos que admite una receta.
- [ ] "Iniciar Inventario" queda deshabilitado con explicación, o funciona, antes de guardar.
- [ ] El cliente rápido de consumidor final no exige datos tributarios.
- [ ] El contador de módulos nuevos refleja un número real.

### S9 — QUI-993 · FEAT/ Grupos de adiciones con buscador de insumo, producto o preparación [admin]

Ticket: https://linear.app/quickss/issue/QUI-993

- [ ] "Adiciones" es un submódulo de Productos, debajo de Marcas, y ya no está en el menú de acciones del listado de productos.
- [ ] Al agregar una adición solo se ve el buscador; los campos aparecen después de elegir el producto.
- [ ] Los campos vienen precargados con los datos del producto y se pueden personalizar.
- [ ] Cada adición del grupo muestra la imagen del producto.
- [ ] Los grupos y adiciones que ya existen siguen funcionando igual.
- [ ] El submódulo se puede mostrar u ocultar por panel, como Marcas.
- [ ] La página se titula "Grupos de adiciones" (hoy dice "Detalles del Producto").

### S10 — QUI-994 · FEAT/ Nota e imagen por adición en el POS, visibles en carrito y recibo [admin]

Ticket: https://linear.app/quickss/issue/QUI-994

- [ ] Cada adición del selector muestra la imagen del producto (o un ícono si no tiene).
- [ ] Cada adición elegida admite una nota, igual que la nota del producto.
- [ ] La línea del carrito lista las adiciones con sus notas (hoy solo dice "Base: $95.000").
- [ ] El recibo muestra las adiciones, sus notas y la nota de la línea.
- [ ] El detalle del pedido programado y la lista de producción muestran las notas de cada adición.
- [ ] Una venta con adiciones sin nota funciona igual que hoy.
- [ ] El botón de cerrar del modal de adiciones muestra su ícono (hoy es un círculo gris vacío).

### S11 — QUI-1000 · FEAT/ KDS con flujo de adiciones como Producción [api][admin]

Ticket: https://linear.app/quickss/issue/QUI-1000

- [ ] El ticket de KDS lista las adiciones de cada plato con cantidad, imagen y nota.
- [ ] Desde el ticket se ve la receta del plato y la de las preparaciones de las adiciones, igual que en Producción.
- [ ] Al mandar a cocina también se descuentan los componentes de las adiciones, una sola vez.
- [ ] Un plato sin adiciones se ve y descuenta igual que hoy.
- [ ] Al KDS solo llegan platos sin "Producido en lote": los vendidos para ya, al cobrar, y los programados, cuando se envían desde la agenda el día del pedido. Un plato en lote, tenga o no adiciones, nunca llega al KDS.
- [ ] Si a la receta le falta stock de una preparación por lote, al mandar a cocina se descuentan los insumos de esa preparación ([QUI-990](https://linear.app/quickss/issue/QUI-990/fix-la-venta-no-usa-el-stock-de-preparaciones-hechas-por-lote-api)).

### S12 — QUI-999 · FEAT/ Línea divisoria entre KDS y Producción, visible en la orden [api][admin]

Ticket: https://linear.app/quickss/issue/QUI-999

Matriz de decisión (literal del ticket, Rafael, 2026-11-09):

> Principio: a Producción solo va lo producible, sin excepciones. Producible significa marcado "Producido en lote" y con receta activa. Las adiciones nunca deciden el destino. Solo bloquea la regla sin sobreventa que ya existe.
>
> Aplica a toda venta, por POS y por ecommerce.
>
> | Producto | Para ya | Programado |
> | -- | -- | -- |
> | Producible, con stock | Cajero elige: stock (defecto) o Producción | Cajero elige: reservar stock (defecto) o Producción |
> | Producible, sin stock o sin inventario | Producción | Producción |
> | Plato preparado no producible | KDS al cobrar | KDS el día del pedido: se envía desde la agenda con "Enviar a cocina" |
> | Otro no producible, con stock | Sale del stock | Sale del stock, apartado para la fecha |
> | Otro no producible, sin stock | Bloquea (sin sobreventa) | Bloquea (sin sobreventa) |
> | Otro no producible, sin inventario | Solo registra la venta | Solo registra la venta |
>
> * **Adiciones:** van con su línea. Descuentan su stock donde se consuma la línea: al vender, al mandar a cocina o al iniciar producción.
> * **Plato programado no producible:** queda en la agenda hasta el día del pedido. El botón "Enviar a cocina" lo manda a KDS y en ese momento se descuentan la receta y las adiciones. Antes de eso no se descuenta nada.
> * **Aviso sin bloqueo:** un producto no producible en un pedido programado muestra en el POS y en la agenda "Este producto no es producible: sale del stock" o, si es plato, "se enviará a cocina el día del pedido". Le sigue "Para gestionarlo en Producción, márcalo como 'Producido en lote'." e incluye un enlace a la ficha del producto.
>
> Definiciones: Plato preparado: `product_type = prepared`. Producible: flag "Producido en lote" (`is_batch_produced`) con receta activa. Inventario: `track_inventory`. Cajero elige: selector por línea en el POS. En ecommerce se aplica el valor por defecto. La elección del cajero (stock o Producción) debe quedar guardada en la línea, para que el consumo y el detalle de la orden la respeten. Solo aplica a la industria restaurante.

Contrato técnico de T12 (decisión del orquestador, ver L15/L16):

- Columna nueva `order_items.fulfillment_destination`, enum Prisma `order_item_fulfillment_destination_enum` con `kds`, `production`, `stock`; nullable (NULL = línea anterior a T12 o tienda no restaurante; se comporta como hoy). Migración aditiva.
- Una sola función pura del backend resuelve el destino por línea con la matriz (`resolveLineDestination`), usada por todos los puntos que crean líneas de venta de restaurante (POS, ecommerce, mesa, cambios de ítem). Fija también `skip_kds`: `kds` → `false`; `stock` y `production` → `true` (mecanismo "usar stock" que ya respetan fire, entrega, reservas y devoluciones). Así un plato en lote nunca llega al KDS (criterio movido desde S11).
- El POS envía la elección del cajero por línea en `fulfillment_destination` (`stock` | `production`); el servidor solo la acepta donde la matriz dice "Cajero elige" y si no aplica la ignora y usa la matriz. Ecommerce nunca la envía: valor por defecto.
- Una línea `production` no descuenta stock propio al cobrar ni al entregar mientras no exista su orden de producción ligada (T13/QUI-995 la crea, reserva y consume). Una línea `stock` se descuenta como retail; programada, se reserva para la fecha con la reserva que ya existe.
- Toda validación, reserva o descuento de stock propio excluye las líneas `production` (si no, "Producible, sin stock → Producción" chocaría con la regla sin sobreventa): pre-chequeo de stock del cobro POS (`payments.service.ts` ~1369-1445), demanda de reserva del borrador/mesa (`order-flow.service.ts` `collectDraftReservationDemand` ~1558), paso 3 de `order-stock-commit`, chequeos de stock del checkout ecommerce y devoluciones (`refund-flow.service.ts` ~1094/1128: una línea `production` sin orden ligada no repone stock).
- Las respuestas de producto que usa el POS (búsqueda/listado del POS) incluyen `is_producible: boolean` (`is_batch_produced` y receta activa). El detalle del pedido programado devuelve por línea `fulfillment_destination`, `product_id`, `product_type` e `is_producible`, para el aviso y el enlace a la ficha.
- Consecuencia de la matriz: un plato preparado no producible siempre va a KDS; el modal actual "Producir por KDS / Usar stock" (`pos-prepared-choice-modal`) deja de aplicar a esos platos y el selector de la línea "Del stock / A producción" queda solo para producibles con stock. El servidor ignora `skip_kds` del cliente donde la matriz no deja elegir.
- El detalle de la orden y el del pedido programado devuelven `fulfillment_destination` por línea; el estado de KDS solo se muestra en líneas `kds`. El enlace y estado de la orden de producción llegan con T13.

- [ ] Toda venta de restaurante, por POS o ecommerce, sigue la matriz de decisión.
- [ ] A Producción solo llegan productos producibles, sin excepciones.
- [ ] A KDS solo llegan platos no producibles: los vendidos para ya, al cobrar, y los programados, cuando se envían desde la agenda.
- [ ] La agenda tiene el botón "Enviar a cocina" en los platos programados no producibles. Antes de pulsarlo no se descuenta nada.
- [ ] Las adiciones nunca cambian el destino de la línea. Descuentan su stock donde se consume la línea.
- [ ] Donde la matriz dice "Cajero elige", la línea del POS muestra el selector con el valor por defecto marcado. En ecommerce se aplica el valor por defecto.
- [ ] El POS ya no obliga a programar una línea por tener adiciones.
- [ ] El aviso "Este producto no es producible…" aparece en programados no producibles, sin bloquear el cobro.
- [ ] El detalle de la orden muestra por línea su destino y el estado y enlace de Producción o de KDS cuando corresponda (hoy solo muestra KDS).
- [ ] El pedido programado muestra por línea el estado de su destino (Producción, KDS después de enviarla o Del stock). Una línea que KDS no gestiona nunca muestra estado de KDS.
- [ ] En una orden mixta, cada línea muestra su propio destino.
- [ ] El toggle "Producido en lote" de la ficha del producto ya no dice "Sub-receta": explica que el producto lo hace Producción y mantiene stock propio, sea preparación o producto terminado. Texto propuesto: "Lo hace Producción y mantiene stock propio. Aplica a preparaciones y a productos terminados."

### S13 — QUI-995 · FEAT/ Producción sincronizada con las ventas [api][admin]

Ticket: https://linear.app/quickss/issue/QUI-995

- [ ] Crea una orden de producción, con las cantidades de la compra, todo lo que la regla de competencia de [QUI-999](https://linear.app/quickss/issue/QUI-999/feat-linea-divisoria-entre-kds-y-produccion-visible-en-la-orden) manda a Producción, por POS y por ecommerce.
- [ ] La orden muestra la receta del producto base, las adiciones, las notas de la compra por producto, las recetas de las preparaciones de las adiciones y las imágenes.
- [ ] Esa misma vista está en la agenda, la Lista de producción, la Producción activa ([QUI-1002](https://linear.app/quickss/issue/QUI-1002/feat-produccion-activa-timeline-del-dia-con-cronometro-apiadmin)) y el módulo Producción, en restaurante y en manufactura (Planta).
- [ ] Iniciar, completar o cancelar desde cualquiera de esos lugares se refleja en los demás.
- [ ] El inventario y el asiento contable se registran una sola vez, sin importar desde dónde se gestione.
- [ ] La orden de producción enlaza al pedido y el pedido enlaza a su orden de producción.
- [ ] Una venta con varios productos para Producción crea una orden de producción por producto, agrupadas por pedido, y se gestionan juntas.
- [ ] Cuando se completan todas las órdenes de producción de un pedido, el pedido queda "Producción finalizada, lista para entrega".
- [ ] Lo producido para un pedido queda reservado para ese pedido al finalizar la producción: el disponible no cambia y ninguna otra venta lo puede tomar.
- [ ] Al entregar el pedido, la reserva se consume y el producto sale del stock una sola vez.
- [ ] Si el cajero eligió "A producción" teniendo stock, el stock existente sigue disponible para otras ventas.
- [ ] Si se cancela un pedido con la producción ya finalizada, la reserva se libera y el sistema pregunta, sin bloquear, "Liberar al stock" o "Dar de baja como merma". Propone merma si la línea tiene adiciones o notas, y liberar al stock si no.

Contrato técnico de T13 (decisión del orquestador con el mapa del explorador, ver L19):

- **Esquema (migración aditiva, `-- DATA IMPACT: none`):** `production_orders.order_id Int?` con FK a `orders` (`onDelete: NoAction`), `@@unique([order_id, product_id])` (las órdenes manuales tienen `order_id` NULL y no chocan) y `@@index([store_id, order_id])`. Relación inversa `orders.production_orders`. No se toca `order_state_enum`: "Producción finalizada, lista para entrega" se deriva en lectura.
- **Creación:** un servicio idempotente `ensureForOrder(order_id)` agrupa por `product_id` las líneas `fulfillment_destination = 'production'` y crea una orden por producto: `source = 'order'`, `order_id`, `planned_qty` = suma de cantidades, receta activa, `order_number` por `store_sequences` (como Planta), `due_date` = `scheduled_start` del agendamiento o la fecha de la venta, estado `draft`. Sin validar múltiplo de rendimiento: la cantidad es la de la compra. Si la orden ya existe y está en `draft`, ajusta `planned_qty` a la suma. Corre tras el commit en todo punto que crea o agrega líneas de venta de restaurante (POS, ecommerce, mesa, cambios de ítem y pedido programado). Se crea al existir la venta, también en ecommerce pendiente de pago (asunción: queda en `draft`; cancelar la venta la cancela).
- **Iniciar (`start`):** sin efecto de stock, como hoy. Al pasar un pedido programado a `in_production`, sus órdenes ligadas en `draft` pasan a `in_progress`.
- **Completar (`complete`), en una sola transacción:**
  - Primero, guard atómico de estado (`updateMany` condicionado al estado leído; si cuenta 0 → `PRODUCTION_ORDER_CONCURRENT_UPDATE` y rollback). Aplica a toda orden, manual o ligada, en restaurante y en Planta.
  - En una orden ligada, consume además las adiciones de sus líneas: reclama `addons_consumed_at` por línea, igual que el fire y el pedido programado, para que nunca se descuenten dos veces. Su costo entra al costo de la orden, así el asiento `production.completed` es uno solo.
  - Reserva `min(producido, planeado)` para `('order', order_id)` sin validar disponibilidad. Si la venta ya está entregada o finalizada, descuenta lo producido como salida de venta y marca las líneas `inventory_committed`. Si está cancelada, no reserva.
- **Entrega (`OrderStockCommitService`):** una línea `production` con su orden completada sigue el camino normal de stock: consume su reserva y baja `on_hand` una sola vez. Sin orden completada, se salta como hoy y no la marca `inventory_committed`. El completado posterior la descuenta.
- **Pedido programado:** el arranque (`ScheduledOrderProductionService.start`) excluye las líneas con orden de producción ligada. Así la receta y las adiciones solo las consume la orden de producción. Una línea antigua sin orden ligada sigue igual.
- **Cancelar la venta (`cancelOrder`):** las órdenes ligadas en `draft` o `in_progress` se cancelan. En las `completed`, la reserva se libera según `productionDisposition`:
  - `release`: queda disponible.
  - `waste`: baja de stock como merma, con el mismo mecanismo de `kitchenDisposition = 'waste'`.
  - El campo es opcional en `CancelOrderDto`. Si falta, el servidor aplica la sugerencia: `waste` si alguna línea ligada tiene adiciones o notas, `release` si no. Nunca devuelve 422: la pregunta no bloquea.
- **API para el frontend:**
  - `GET store/production-orders/:id` agrega:
    - `source` y `order_id`.
    - `sale_order { id, order_number, state, customer_name, due_at }` o `null`.
    - `product { id, name, image_url }` y la receta base con componentes (nombre, cantidad, unidad, imagen).
    - `order_lines[] { order_item_id, quantity, notes, addons[] { group_name, option_name, note, image_url, recipe { components[] } | null } }`.
  - `GET store/production-orders` acepta `order_id` y devuelve `source`, `order_id` y `sale_order_number`.
  - El detalle de orden (`GET store/orders/:id`) agrega:
    - Por ítem `production`: `production_order { id, order_number, status }`.
    - En la orden: `production_status` (`none` | `pending` | `in_progress` | `completed`; `completed` = todas las ligadas completadas, que se muestra como "Producción finalizada, lista para entrega") y `production_cancel_suggestion` (`release` | `waste` | `null`).
  - El detalle del pedido programado y la lista de producción devuelven por línea el mismo `production_order`.
- **Vista compartida:** un componente de detalle de orden de producción con receta, adiciones con su nota y receta, notas, imágenes, enlace al pedido y acciones Iniciar, Completar y Cancelar sobre los mismos endpoints. Se abre desde:
  - Producción (restaurante): nueva ruta de detalle.
  - El detalle de la orden: enlace por línea y estado de la orden.
  - El detalle del pedido programado y la Lista de producción, en modal.
  - El detalle de Planta: sección "Pedido de venta" cuando hay `order_id`.

  Las acciones sobre la misma fila hacen que todos los lugares muestren el mismo estado. La actualización en vivo sin recargar es de T15.
- **Fuera de alcance (anotado):**
  - Cancelar un ítem suelto con producción completada: la reserva sobrante la limpia el barrido de la entrega.
  - Líneas con variante: la orden es por producto y reserva a nivel base, como acredita el completado.

### S14 — QUI-996 · FEAT/ Rediseño de Pedidos programados: agenda y producción en línea de tiempo [admin]

Ticket: https://linear.app/quickss/issue/QUI-996

- [ ] La agenda y la lista de producción siguen el patrón estándar de módulos de Vendix (resumen, encabezado fijo, vista adaptable) y su lenguaje visual.
- [ ] La lista de producción es una línea de tiempo, con enlace directo a la orden de producción y acciones de gestión.
- [ ] La lista de producción tiene filtro por día y el botón "Iniciar producción del día", que abre la Producción activa ([QUI-1002](https://linear.app/quickss/issue/QUI-1002/feat-produccion-activa-timeline-del-dia-con-cronometro-apiadmin)).
- [ ] La lista de producción no es exclusiva de pedidos programados: es la misma vista en Operaciones → Producción (restaurante) y en Planta (manufactura).
- [ ] Los títulos son correctos: hoy dicen "Panel Principal" y "Ordenes de Venta".
- [ ] Las dos páginas funcionan bien en móvil.
- [ ] La URL directa de la lista de producción ya no redirige al POS.

Contrato técnico de T14 (decisión del orquestador con el mapa del explorador, ver L23):

- **Vista compartida, un solo componente:** `ProductionDayListComponent` (standalone, en `restaurant-ops/production/components/production-day-list/`) es la Lista de producción. Se monta en tres rutas: `/admin/scheduled-orders/production` (desde Pedidos programados), `/admin/restaurant-ops/production/day` (Operaciones → Producción) y `/admin/manufacturing/orders/day` (Planta). Recibe por `data` de ruta la ruta base del detalle (`detailBase`), la de la Producción activa (`activeBase`, la agrega T15), `manageInline` (Planta = `false`: sin iniciar/finalizar/cancelar en la lista ni modal de restaurante, porque sus órdenes pasan por «liberar»; cada orden abre su detalle de Planta) y `consolidatedPath` (insumos consolidados imprimibles, solo en Pedidos programados).
- **Datos (backend):** `GET store/production-orders/day?date=YYYY-MM-DD`, con permiso `store:production_orders:read` o `store:manufacturing:orders:read` (cualquiera de los dos). El día se toma en la zona horaria de la tienda (fallback `America/Bogota`). Entra toda orden no cancelada del día: la ligada a una venta por el instante de entrega (`due_date`), la manual por su fecha planificada (`due_date` es fecha sin hora, medianoche ingenua) y, sin `due_date`, por `created_at`. También entran las órdenes `in_progress` de días anteriores (multi-día, S15). Devuelve tarjetas:
  - Una por venta: las órdenes con el mismo `order_id`, con `sale_order_number`, la hora de entrega (`due_date`) y el cliente si lo hay.
  - Una por orden manual.
  - Cada orden lleva `id`, `order_number`, producto, `planned_qty`, `status`, `started_at`, `produced_at` y `due_date`.
  - Orden: las ligadas por hora de entrega; las manuales por `due_date` y luego `created_at`.
  - La tarjeta deriva su estado: En espera (todas `draft`/`released`), En producción (alguna `in_progress`) o Finalizada (todas `completed`).
- **Frontend de la lista:**
  - Línea de tiempo vertical por hora con el patrón estándar: `app-sticky-header`, resumen `app-stats` (en espera, en producción, finalizadas) y filtro por día (anterior, hoy, siguiente y selector).
  - Cada orden enlaza a su detalle y tiene acciones de gestión (iniciar, finalizar o cancelar, según su estado, con los endpoints existentes). Se abre con el modal de detalle de T13.
  - Botón "Iniciar producción del día" que navega a la Producción activa de esa fecha (`.../active?date=`). Se muestra solo si la ruta trae `activeBase`; T15 lo agrega junto con la página.
  - La página anterior de Pedidos programados (insumos consolidados e impresión) se conserva en `/admin/scheduled-orders/production/insumos` y se abre desde la acción "Insumos consolidados" de la lista.
  - Labels: En espera, En producción, Finalizada.
- **Agenda de Pedidos programados:** se rediseña con el patrón estándar (`app-sticky-header`, `app-stats`, vista adaptable) sin cambiar su lógica ni sus endpoints. Es móvil primero.
- **Títulos:** las entradas de `breadcrumb.service.ts` cubren las cuatro rutas nuevas y las existentes: "Agenda de pedidos", "Lista de producción" y "Producción activa". Ninguna de estas páginas muestra "Panel Principal" ni "Ordenes de Venta".
- **Acceso:** la URL directa de la lista no debe redirigir al POS. La ruta de Pedidos programados hereda la llave `orders_scheduled` (solo restaurante). Las rutas de Operaciones y de Planta usan sus propias llaves (`restaurant_ops_production` y `manufacturing_orders`), porque la llave se resuelve por el prefijo más largo.
- **Reutiliza:** `ProductionOrdersService` del frontend (agrega `getDay(date)`), el modal de detalle de T13, los componentes estándar y `CurrencyPipe`/fechas según `vendix-date-timezone`. La lista de producción de pedidos programados (`GET scheduled-orders/production-list`) deja de usarse en esa página, pero el endpoint no se borra.

### S15 — QUI-1002 · FEAT/ Producción activa: timeline del día con cronómetro [api][admin]

Ticket: https://linear.app/quickss/issue/QUI-1002

- [ ] La Lista de producción y la Producción activa son vistas compartidas. En restaurante se abren desde Pedidos programados y desde Operaciones → Producción. En manufactura se abren desde Planta.
- [ ] La Lista de producción tiene filtro por día y el botón "Iniciar producción del día", que abre la Producción activa de ese día.
- [ ] El timeline muestra todas las órdenes de producción del día. Las ligadas a ventas o pedidos programados se ordenan por hora de entrega; las manuales, por fecha planificada o de creación.
- [ ] Una venta con varios productos para Producción se ve como una sola tarjeta por pedido, con una orden de producción por producto. Iniciar o finalizar la tarjeta mueve todas sus órdenes. Solo entran las líneas que la matriz de [QUI-999](https://linear.app/quickss/issue/QUI-999/feat-linea-divisoria-entre-kds-y-produccion-visible-en-la-orden) manda a Producción.
- [ ] Cada orden muestra En espera, En producción o Finalizada, y el timeline se desplaza hacia lo que está en curso.
- [ ] Se puede iniciar y finalizar desde la vista.
- [ ] Varias órdenes pueden estar en producción a la vez, cada una con su cronómetro. El timeline se centra en la más antigua en curso.
- [ ] Con tiempo estimado, el cronómetro cuenta en reversa; sin tiempo, cuenta hacia arriba. El tiempo estimado se toma del tiempo de preparación del producto y se puede cambiar en cada orden.
- [ ] El cronómetro se calcula desde la hora de inicio guardada, así que muestra lo mismo al recargar o en otro equipo.
- [ ] Al finalizar, la orden de producción queda completada en todos los módulos. Si viene de un pedido, el pedido queda "Producción finalizada, lista para entrega".
- [ ] Una orden que dura varios días sigue en el timeline hasta finalizarse, y el calendario cambia de día.
- [ ] Iniciar o finalizar en Pedidos programados, la Lista de producción, la Producción activa o las Órdenes de producción se refleja en los demás sin recargar.
- [ ] (Inferido) Cuando el cronómetro en reversa llega a cero, sigue contando como tiempo excedido.

Contrato técnico de T15 (decisión del orquestador, ver L23):

- **Esquema (migración aditiva, `-- DATA IMPACT: none`):** `production_orders.estimated_minutes Int?`. Su valor efectivo es `estimated_minutes ?? products.preparation_time_minutes ?? null`, calculado en lectura. Se edita por orden con `PATCH store/production-orders/:id` (campo opcional nuevo, entero ≥ 0 o null).
- **Inicio con hora guardada:** `start()` de restaurante guarda `started_at = now()` (hoy no lo guarda; Planta sí). La finalización ya guarda `produced_at`.
- **Tarjeta por venta:** `POST store/production-orders/sale/:orderId/start` y `.../complete` mueven todas las órdenes de esa venta que estén en el estado de origen. Cada una pasa por el mismo `start()`/`complete()` individual, con su claim atómico, en una sola transacción por orden. Una orden ya movida se omite sin error. Al finalizar, el pedido muestra "Producción finalizada, lista para entrega" (derivado, T13).
- **Planta:** una orden de manufactura `released` se inicia con su propio `start` de manufactura; una `draft` de manufactura sigue En espera y se libera desde su detalle. La vista elige el endpoint según `source`/estado.
- **Sincronía en vivo:**
  - Un `ProductionSseService` backend propio, con un `Subject` por tienda, separado del de notificaciones para no generar notificaciones. Se expone en `@Sse('stream')` en `store/production-orders/stream` (patrón KDS: auth `?token=`, heartbeat, sin DTO de query validado).
  - Emite `production_order.updated` con `{id, order_id, status, started_at, produced_at, estimated_minutes}` al crear, iniciar, finalizar, cancelar o editar. La emisión va tras el commit y su fallo no rompe la operación.
  - Frontend: `ProductionSseService` como el SSE del KDS (backoff y polling de respaldo). Pedidos programados (agenda y detalle), la Lista de producción, la Producción activa y la lista y el detalle de Órdenes de producción se refrescan al recibir el evento.
- **Producción activa (frontend):** página compartida montada en `/admin/restaurant-ops/production/active` y `/admin/manufacturing/orders/active`; también se abre desde Pedidos programados.
  - Usa el mismo `GET .../day?date=`.
  - Muestra el timeline horizontal o vertical del día, con tarjetas por pedido, y se desplaza a la orden en curso más antigua.
  - Cada orden en producción tiene un cronómetro calculado desde `started_at` con el reloj del cliente. Con tiempo estimado cuenta en reversa y, al pasar de cero, sigue como tiempo excedido; sin tiempo, cuenta hacia arriba.
  - Se edita el tiempo estimado por orden, e iniciar y finalizar funcionan por orden y por tarjeta.
  - Una orden multi-día sigue visible hasta finalizarse. El selector de día cambia de fecha.

## Tasks

| ID | Spec | Ticket | Ruta | Estado | Commit / evidencia |
| -- | -- | -- | -- | -- | -- |
| T1 | S1 | QUI-988 | delegado (sonnet) | hecho · 6be9edcb3 | kitchen-fire.service.spec 101/101 (RED 720≠520 → GREEN) |
| T2 | S2 | QUI-989 | delegado (sonnet) | hecho · bfa054195 | payments.scheduled-fire 2/2, scheduled-order-production 12/12 (RED 5), payments.service 194/194; audit singleton OK |
| T3 | S3 | QUI-990 | delegado (sonnet) | hecho · 0f3784c0b | kitchen-fire.service.spec 110/110 (RED 4/7), scheduled-order-production 15/15 (RED 3/3), recipes.service 47/47 (RED opción) |
| T4 | S4 | QUI-1001 | delegado (sonnet, paralelo a T3) | hecho · 754888855 | industry-module.guard 12, parity 6, ecommerce-product-options.controller 3 (nuevo), industry-module.controllers 45, product-options.module 1; karma de menu-filter no ejecutado (prohibido ng test) |
| T5 | S5 | QUI-992 | delegado (sonnet, paralelo) + ajuste inline | hecho · c343cf995 | specs karma de pos-cash-register no ejecutados (prohibido ng test); verificación en navegador pendiente |
| T6 | S6 | QUI-998 | delegado (sonnet, paralelo) | hecho · 74b5d2b49 | auth.reducer.spec (2) no ejecutado (karma); verificación en navegador pendiente |
| T7 | S7 | QUI-991 | delegado (sonnet, paralelo a T9) | hecho · c2704556a | scheduled-orders.service 15/15 (RED: detail.order.users undefined), scheduled-order-production 16/16 (RED por select retirado); frontend sin ejecutar |
| T8 | S8 | QUI-997 | delegado (sonnet, paralelo a T10) + contador y recibo inline | hecho · 9c8cfd5d3 | panel-ui-merge.util 19/19 (RED 2), production-orders.service 19/19 (RED 1 contra base); frontend sin ejecutar (karma prohibido) |
| T9 | S9 | QUI-993 | delegado (sonnet, paralelo a T7) + ajuste inline | hecho · 2e8c88719 | default-panel-ui.service 5/5 (rojo en base por `orders_scheduled` sin default; corregido); karma de menu-filter no ejecutado |
| T10 | S10 | QUI-994 | delegado (sonnet, paralelo a T8) + recibo inline | hecho · 6ffc5ec1c + corrección c1dfd3dd0 · verificador: 2 bloqueos corregidos · RDD aprobada (review-ec2e5a9d21a08d40) | product-options.service 8/8, scheduled-orders 15/15, scheduled-order-production 16/16, payments.service 198/198, orders.service 194/194 (RED en cada uno), pos-sale-ticket-options 3/3 (RED 2), print-layout-composer 25/25 (RED 1), pos-sale-ticket-parity 16/16; audit singleton OK |
| T11 | S11 | QUI-1000 | delegado (sonnet) + auditoría inline | hecho · 6d76a0808 + corrección 30fd00a26 · verificador: 2 bloqueos corregidos · RDD aprobada (review-7531245ae465c481) | kitchen-fire-addons 10/10 (RED pool), kitchen-fire.service 110/110, scheduled-order-production 23/23, scheduled-orders.service 16/16, batch-bom-resolver 3/3; sondas del verificador P1a/P1b/P4 verdes; sin cambios de módulo |
| T12 | S12 | QUI-999 | delegado (sonnet, 2 escritores paralelos: backend y frontend) + integración inline | hecho · b8634d087 + corrección 9940ea66a · verificador: 7 bloqueos + A1/A2 corregidos (L22), recomprobación OK (L26) · RDD aprobada (L28) | resolve-line-destination 28/28, line-destination.loader 6/6, orders.service 198/198, order-item-changes 73/73, table-sessions 105/105, order-flow 350/350, refund-flow 40/40, kitchen-fire.service 110/110, scheduled-orders 17/17 (corrida del padre); payments 201/201, checkout 73/73, order-stock-commit 25/25, products 158/158 (escritor; RED en checkout, payments, commit y refund); frontend sin karma (prohibido); sin cambios de módulo |
| T13 | S13 | QUI-995 | delegado (sonnet, 2 escritores paralelos: backend y frontend) + integración inline | hecho · 23e9ad0c6 + corrección c0904a51b + 47f76c025 · verificador: 3 bloqueos corregidos (L24), recomprobación OK (L26) · RDD aprobada en 3 partes (L28) | production-orders 31/31, production-sale-link 18/18 (RED 2 inline), order-stock-commit 27/27, scheduled-orders dir 62/62 + scheduled-orders.service 18/18, order-flow 352/352, orders 201/201, item-changes 74/74, table-sessions 105/105, payments 201/201, checkout 73/73, auto-entry 45/45 (RED 2 inline), partial-batch 2/2; audit singleton OK |
| T14 | S14 | QUI-996 | backend inline (RED→GREEN) + frontend delegado (sonnet) + ajustes inline del padre | hecho · 1f4c4a458 · RDD aprobada (L28) | production-orders-day 7/7 (RED 7 → GREEN), production-orders.service 31/31; frontend sin karma (prohibido); sin cambios de módulo |
| T15 | S15 | QUI-1002 | migración inline + 2 escritores sonnet en paralelo (backend y frontend) + corrección inline del padre | hecho · 6311b4ce1 + corrección bd0e037ab · RDD aprobada en 2 partes (L28) | production-orders-live 18/18 (RED 17), production-order-events 4/4 (RED), production-orders.controller 5/5 (RED 5), production-sale-link 27/27 (RED 3), manufacturing-orders.service 24/24 (RED 3), production-sse.service 3/3, production-orders.service 31/31, production-orders-day 7/7, partial-batch 2/2 (escritor); manufacturing-orders.controller 4/4 (RED 4 → GREEN, padre), production-orders.controller 5/5, production-sse.service 3/3, industry-module.controllers 45/45 (padre); audit singleton OK; frontend sin karma (prohibido) |

Ruta: un escritor Sonnet por ticket, en serie (Writer trigger: backstop de contexto, 15 unidades en una sesión). El orquestador (Opus) audita el diff, corre el spec del cambio y commitea. Verificador independiente en unidades de alto riesgo (stock, migraciones).

## Log

- L1 (2026-11-09, Rafael, literal): "QUIERO QUE EJECUTES TODOS LOS TICKET CON TODOS SUS PLANES 1 A 1 TODOS A UNA SOLA RAMA COMIT POR COMIT CADA UNO AVANZANDO HACIA LA CONSOLIDACION DE EL FLUJO DE PRODUCCION HASTA LOGRAR EL 100% DE LOS TICKETS QUE ACABAMOS DE CONSOLIDAR SU ANALISIS"
- L2 (2026-11-09): L1 autoriza la ejecución sin aprobación adicional del plan. Orden por dependencia: fixes de consumo (988, 989, 990), visibilidad (1001), fixes de UI/POS (992, 998, 991, 997), adiciones (993, 994), KDS (1000), matriz (999), producción ligada (995), agenda (996), producción activa (1002). Las decisiones de producto ya están cerradas en los tickets (matriz QUI-999, tarjeta por pedido, reserva al producir, cancelar → preguntar stock o merma).
- L3 (2026-11-09, T1): assess medium · under_budget (slice abierto desde 5ba3d56c6). Jest en el worktree: `npx jest --runInBand -c jest.isolated.config.js --rootDir src <spec>` (el config por defecto se queda sin heap).
- L4 (2026-11-09, T2): pagos excluyen órdenes con agendamiento del disparo a cocina (POS y cierre de mesa). Nuevo `POST store/scheduled-orders/:id/send-to-kitchen` → `ScheduledOrderProductionService.sendToKitchen()` (dispara solo platos preparados no de lote vía `KitchenFireService.fireOrderItems`, pasa a `in_production`). Pendiente para T11/T12: al pasar a `in_production` el gancho `start()` descuenta adiciones y la receta de los ítems no disparados; cuando QUI-1000 haga que el disparo descuente adiciones, hay que evitar doble descuento, y la matriz (T12) debe sacar de `start()` los ítems que van a Producción/KDS.
- L5 (2026-11-09, RDD slice 2269bb4..bfa054195 = T1+T2): riesgo alto, Rafael concedió revisión (granted), lentes risk + reliability → **aprobada y reconocida** (lineage review-cb1b0371d155c1e2). Hallazgos no bloqueantes para trabajo posterior: (a) `sendToKitchen` dispara a cocina y luego transiciona fuera de una misma transacción; si `start()` falla, el ticket y la receta quedan persistidos y el reintento da `SCHED_NOTHING_TO_SEND` → resolver en T11/T12 junto con el gancho `start()`; (b) el spec de QUI-989 debe afirmar el where exacto `orders: { fulfillment_schedule: { is: null } }` y cubrir el segundo camino (cierre de mesa); (c) carrera entre órdenes distintas sobre la misma fila de stock (preexistente; fuera de alcance); (d) el documento no debe llevar rutas locales absolutas (corregido en T3).
- L6 (2026-11-09, ruta): T3 y T4 en paralelo (Writer trigger a: superficies disjuntas, backend recetas/cocina vs. visibilidad por industria). T4 no corre tests (un solo proceso jest a la vez); el orquestador los corre en serie. El conteo previo al despliegue de QUI-1001 requiere acceso a la DB de prod no autorizado: queda como SQL de solo lectura para ejecutar a mano.
- L7 (2026-11-09, T3): `explodeBom(..., { stopAtBatchProduced: true })` deja la preparación de lote como hoja (`batch_recipe_id`); `recipes/batch-bom-resolver.ts` toma primero su stock vendible (misma lectura del guard sin sobreventa) con un pool por operación y explota solo el faltante. Aplica en `fireOrderItemsInTx` (pagos, cierre de mesa, división, cambios de ítem), el pre-chequeo de `fireOrderItems`, `previewIngredientShortfall` y el `start()` de programados. No crea `production_orders` (T13). Pendiente para T11/T12: una exclusión de un insumo que vive dentro de una receta de lote ahora da `KITCHEN_FIRE_EXCLUSION_NOT_IN_BOM` (el modal muestra la explosión completa); adiciones de receta cuyo producto es de lote aún explotan sin usar su stock (QUI-1000).
- L8 (2026-11-09, RDD): T3 (slice bfa054195..0f3784c0b) aprobada tras una corrección acotada (`applyBatchExclusionFallback`: si la exclusión no está en las hojas de la explosión con lote, se usa la explosión completa; corrige lo anotado en L7) y reconocida (review-01c7878eaa1acb19). T4 (0f3784c0b..754888855) aprobada y reconocida (review-876106f317861644). T5 quedó under_budget y se revisó junto con T6 (754888855..74b5d2b49): aprobada y reconocida (review-a917e3b433ed2217). Próximo límite revisado: 74b5d2b49. Avisos no bloqueantes: T3: lectura sin bloqueo del stock de lote entre disparos concurrentes; pre-chequeo y resolución en tx pueden divergir con `skipIngredientCheck`; la sonda suma todas las ubicaciones mientras el consumo descuenta la ubicación por defecto; el faltante explotado no filtra exclusiones. T4: la API de pedidos programados no lleva `@IndustryModule('orders_scheduled')` (preexistente, todas las industrias podían usarla); el storefront oculta adiciones sin mirar el modo audit/enforce mientras el admin queda en audit; el POS usa `isRestaurant()` en vez del gate compartido; si un estado programado queda activo en tienda no restaurante el toggle ya no se ve (→ T12, al dejar de forzar el agendamiento). T5/T6: faltan specs del flujo de recuperación de caja en el paso de pago (orden saved→closed y persistencia de `pos_register_id` verificados en el modal); el reducer conserva el app_type activo y ningún llamador actual cambia app_type por `updateUserSettings`. T5 se reescribió inline para conservar el chequeo síncrono (los specs del paso de pago llaman `onCollectorSubmit` sobre objetos planos) y solo resolver la caja de forma asíncrona cuando falta. Verificación en navegador de T4–T6 pendiente: el vhost sirve el checkout principal, no este worktree.
- L9 (2026-11-09, ruta): T7 y T9 en paralelo (Writer trigger a: superficies disjuntas, módulo scheduled-orders vs. submódulo de adiciones, menú y panel). Solo T7 corre jest (un proceso a la vez); T9 deja sus specs para que el orquestador los corra en serie. T8 queda después de T7 porque ambos tocan la lista de producción (unidades y plurales); T10 después de T9 porque ambos tocan el formulario de adiciones.
- L10 (2026-11-09, T7): causa raíz: `findOne()` pedía una proyección mínima de la orden y el modal leía `users` y `order_items`. Agenda y detalle comparten `SCHEDULED_ORDER_SELECT`; la agenda ahora omite líneas canceladas (`cancelled_at: null`, igual que la lista de producción). La lista de producción devuelve `notes` y usa `customer_alias` como respaldo. `uomLabel()` traduce "unit" a "und". El escritor tocó `scheduled-order-production.service.ts` (fuera de la superficie declarada, necesario: ahí se arma la lista; sin choque con T9). RDD: medium · under_budget (slice abierto desde 74b5d2b49). T8 espera a T9: comparten `store_admin.routes.ts` (títulos) y el contador de módulos nuevos (menu-filter/app-modules).
- L11 (2026-11-09, T9 y ruta T8/T10): T9: la ruta `/admin/products/option-groups` caía en el breadcrumb de `/admin/products/:id` ("Detalles del Producto"); se agregó su entrada inline. El fallback de panel no tenía `orders_scheduled` (deriva preexistente que dejaba rojo `default-panel-ui.service.spec`); se agregó. Las adiciones guardadas toman su imagen de un catálogo de 200 productos en el modal: T10 agrega `image_url` firmado a `component_product`. RDD: medium · under_budget (slice 74b5d2b49..2e8c88719, 615 líneas). T8 y T10 en paralelo: T10 es dueño del recibo (sistema de impresión) y del POS de adiciones; T8 omite la hora del recibo, que se hace inline al cerrar T10. Solo T10 corre jest.
- L12 (2026-11-09, T8): el contador "178 módulos nuevos" sumaba todas las claves por defecto de cada app_type para usuarios sin `panel_ui_seen_keys`; ahora las claves ya persistidas en `panel_ui[app_type]` cuentan como vistas (`computeNewPanelUiKeys`, 4º parámetro opcional; README actualizado). "01:37:43" venía de `toLocaleString()` sin locale en `pos-ticket.service.ts`; ahora `es-CO` corto ("9/11/26, 1:37 p. m."); el recibo del backend ya usaba `formatStoreTime` (12 h con a. m./p. m.). RDD: medium · under_budget (slice 74b5d2b49..9c8cfd5d3, 898 líneas); cerrado con revisión antes de T10 (alto riesgo) desde un worktree temporal en 9c8cfd5d3, porque la revisión por commits siempre toma base..HEAD. Revisión del slice T7+T9+T8: aprobada (review-3e42e28f30341e45, acknowledged; límite revisado → 9c8cfd5d3). Advisories para trabajo posterior: la entrada de menú de Adiciones perdió su compuerta (`store-admin-menu-items.ts:398-402`, R2/R3-001; revisar en T12); ventanas de estadísticas mixtas: hoy/semana siguen en la zona del contenedor y el mes en la de la tienda (`production-orders.service.ts:751-755`); `default-panel-ui.service.ts:102` (R3-002); el catálogo del modal de adiciones se corta en 200 productos (`option-group-form-modal.component.ts:102`); el efecto de validadores del cliente POS (`pos-customer-modal.component.ts:865-872`, R3-004); mapas de unidades duplicados (`yield-unit.util.ts`).
- L13 (2026-11-09, T10): el recibo lo arma el backend (`pos-sale-ticket.provider.ts`); se agregó `order_item_options` (nombre y nota) al include, `notes` y `modifiers` ("+ Adición — nota") por línea, y el compositor pinta `modifiers` en todo formato (solo cocina y venta POS los llenan). Migración `20261124090000_order_item_options_note` (columna nullable, aditiva). DTO: `option_notes` opcional paralelo a `option_ids`. RDD: high (ítem 1, migración) · revisión aislada con base 9c8cfd5d3; verificador Opus independiente antes de la revisión.
- L14 (2026-11-09, T10 verificación y RDD): el verificador independiente encontró dos bloqueos en el recibo, ambos del código inline: (B1) las reservas de servicio del POS guardan `[BOOKING:{json}]` en `order_items.notes` y el recibo lo imprimía como nota; (B2) con "Mostrar notas" apagado (`show_notes=false`) la nota de cada adición seguía saliendo dentro de `modifiers`. Corrección única (c1dfd3dd0): `StandardPrintItem.addons` estructurado (nombre y nota), `stripBookingMarker()` en el provider, `modifiers` vuelve a pintarse solo en la comanda de cocina y la nota de la adición sigue a `show_notes`. Recheck limitado con las sondas del verificador: los dos defectos ya no se reproducen y el escape HTML se mantiene; sondas borradas. Specs: pos-sale-ticket-options 4/4, print-layout-composer 27/27, pos-sale-ticket-parity 16/16. RDD 9c8cfd5d3..c1dfd3dd0: riesgo alto, Rafael concedió revisión, lentes risk + reliability → **aprobada y reconocida** (review-ec2e5a9d21a08d40). Avisos no bloqueantes: regex del marcador de reserva no tolera `}]` dentro del JSON (payments.service lo arma plano); persistencia de `option_notes` sin prueba de integración; el recibo ahora imprime la nota de línea en toda venta POS (alcance de QUI-994); `applicableForProduct` firma S3 dentro del cobro y del checkout (A1 del verificador). Otros avisos del verificador: A2 el storefront público devuelve la imagen firmada del componente; A3 las adiciones no salen en la impresión de factura electrónica POS ni en la reimpresión deprecada del frontend; A4 `savedImages` es un `Map` plano en option-group-form-modal. Próximo límite revisado: c1dfd3dd0.
- L15 (2026-11-09, T11 auditoría y alcance): el diff del escritor saltaba en el fire los platos "Producido en lote" (`products.is_batch_produced`). La auditoría mostró que unos 6 predicados tratan "restaurante + `prepared` + `!skip_kds`" como línea de cocina: `order-action-policy.util.ts:569` y `:763` (la orden queda "pendiente en cocina" y no se puede entregar), `order-flow.service.ts:1558` (no reserva el plato), el paso 3 de `order-stock-commit` (nunca se descuenta), `payments.service.ts:1440` y `refund-flow`. El mecanismo existente para "se vende de stock y no va a cocina" es `skip_kds` por línea ("usar stock" del cajero), que todos esos predicados ya respetan. Decisión: la regla "un plato en lote nunca llega al KDS" para ventas POS/ecommerce pasa a T12, que fija `skip_kds=true` al crear la línea según la matriz de QUI-999; el commit de T11 no la incluye y el comportamiento de los platos en lote en el fire queda igual que en la base. Para pedidos programados ya se cumple: `sendToKitchen` solo dispara platos no de lote (`scheduled-orders.service.ts:79`). T11 (6d76a0808): adiciones en el ticket de KDS (cantidad, imagen firmada, nota, receta de sus preparaciones), descuento de componentes de adiciones al disparar (una sola vez, `addons_consumed` evita repetirlo en `start()`), preparaciones por lote con stock primero (`resolveBatchComponent`) y `sendToKitchen` atómico (`fireOrderItems(dto, { withinTx })`). Puntos abiertos para el verificador: líneas disparadas antes del despliegue y sus adiciones en `start()`; adiciones de un plato en lote; cancelación de ticket sin reponer movimientos de adiciones.
- L16 (2026-11-09, T12 ruta y contrato): la matriz literal de QUI-999 se copió a S12 junto con el contrato técnico. Ruta: dos escritores en paralelo (Writer trigger a: superficies disjuntas, backend vs. frontend, cada uno con varios archivos), con el contrato de S12 como única interfaz. El escritor de frontend no ejecuta procesos de Node (karma, tsc y ngc prohibidos); el de backend corre sus specs en serie cuando no haya otro proceso jest. Incluye los avisos pendientes de L12 (entrada de menú "Adiciones" sin su compuerta en `store-admin-menu-items.ts:398-402`) y el texto del toggle "Producido en lote".
- L17 (2026-11-09, T11 verificación y corrección): el verificador independiente encontró dos bloqueos. (B1) `start()` tomaba `inventory_consumed_at_fire` como «adiciones ya descontadas»: una línea disparada antes del despliegue (adiciones nunca descontadas) las perdía al iniciar producción. (B2) el disparo usaba un pool de reclamos de lote para el plato y otro para las adiciones: con 1 unidad en el estante y plato + adición de la misma preparación, ambos tomaban la misma unidad. Corrección única (30fd00a26): columna `order_items.addons_consumed_at` (migración `20261124100000_order_item_addons_consumed_at`, nullable, sin backfill, agregada a `assert-schema-columns.js`), que el disparo y el inicio reclaman línea por línea (`updateMany where addons_consumed_at null`) antes de descontar; las líneas viejas quedan en NULL y `start()` sigue descontando sus adiciones como antes. El disparo comparte un solo `BatchClaimPool` entre platos y adiciones. Recheck limitado con las sondas del verificador sin modificar: P1a `[[900,-1],[901,-200]]`, P1b sin negativo, P4 igual a la base `[[700,-160]]`. La sonda P5 original falla porque su mock modela el marcador viejo; la variante P5b, que modela la columna nueva, descuenta la adición una sola vez. Sondas y worktree borrados. RDD c1dfd3dd0..30fd00a26 en worktree temporal limpio (el árbol principal tiene archivos sin rastrear de T12).
- L18 (2026-11-09, T11 RDD y T12 auditoría): RDD c1dfd3dd0..30fd00a26 (riesgo alto, ítem 1; Rafael concedió revisión; lentes risk + reliability) → **aprobada y reconocida** (review-7531245ae465c481). Avisos no bloqueantes: R3-001 el disparo ordinario (cobro POS, mesas) sigue con el timeout por defecto de la transacción interactiva y ahora hace más trabajo por línea con adiciones; R3-002 la rama `withinTx` no tiene prueba directa de rollback y orden de `afterCommit` con `$transaction` real; R3-003 el disparo redondea a unidades enteras por línea y el inicio consolida antes de redondear, así que con cantidades fraccionarias el total puede diferir según quién descuente. Próximo límite revisado: 30fd00a26. T12 backend (escritor sonnet): resolver puro `resolveLineDestination` + cargador por lotes `resolveLineDestinations` (≤3 consultas), aplicado en cobro POS, cierre de mesa, checkout ecommerce, alta/edición de pedidos, cambios de ítems y división del disparo; predicado único `lineConsumesOwnStock` (una línea `production` no valida, reserva ni descuenta stock propio) en prevalidación del cobro, demanda de borradores, paso 3b del commit, checkout y reembolso. Auditoría: los predicados de cocina (`order-action-policy` :569/:763, `order-flow` :1559, `order-stock-commit` :638, reembolso) siempre combinan `skip_kds` con `prepared`, así que `skip_kds=true` en líneas estándar no cambia su ruta. El cliente que manda `skip_kds=true` en un plato preparado no producible queda en KDS por la matriz (el aviso «usar stock» del POS se quitó). Se agregó `order_items.fulfillment_destination` a `assert-schema-columns.js` (fuera de la superficie del escritor).
- L19 (2026-11-09, T13 mapa y contrato): el explorador confirmó cuatro hechos. (a) Ninguna venta crea hoy `production_orders` y no hay FK a `orders`. (b) `complete` no tiene guard atómico: dos pantallas podrían duplicar inventario y asiento. (c) El barrido final de la entrega consume toda reserva `order` sin bajar `on_hand`. (d) Cancelar una orden completada da 409. Hay precedente de pregunta al cancelar: `kitchenDisposition`. Decisiones del orquestador:
  - El estado "lista para entrega" se deriva, no es un enum nuevo.
  - La orden se crea al existir la venta, también en ecommerce pendiente de pago (asunción).
  - La cantidad es la de la compra, sin múltiplo de rendimiento.
  - Las adiciones de una línea de producción se consumen al completar, dentro del mismo asiento: su costo integra el producto personalizado reservado.
  - El completado reserva; la entrega consume por el camino normal; un pedido ya entregado descuenta al completar.
  - La pregunta al cancelar tiene valor por defecto en el servidor y no da 422.

  Ruta: dos escritores Sonnet en paralelo (Writer trigger a: backend y frontend con superficies disjuntas, cada uno con varias centenas de líneas). El frontend programa contra el contrato de API de S13. Riesgo: ítem 1 (migración + stock/reservas) e ítem 4 (completado concurrente) → verificador independiente y RDD.
- L20 (2026-11-09, T12 verificación independiente): veredicto **no cumple**. La migración y la paridad legacy/no restaurante están bien (sonda p5, 4/4). Siete bloqueos causados por el cambio:
  - **B1:** vender "para ya" con adiciones da 400 `OPT_REQUIRES_SCHEDULE` (`option-pricing.service.ts:156`, `payments.service.ts` `assertAdoptedOptionsScheduled` ~4199).
  - **B2:** al editar una orden (`PUT /store/orders/:id/items`), una línea "Del stock" pasa a Producción y pierde su reserva. El resolver lee un disponible que ya descuenta la reserva propia (`orders.service.ts:3525` antes de `:3561`).
  - **B3:** en el checkout ecommerce, un producto terminado producible sin stock reserva y falla después de crear orden y pago (`shouldReserveStock` en `checkout.service.ts:2862/3712/4451` solo difiere `prepared`).
  - **B4:** la elección del cajero se ignora en mesa, cambios de ítem y edición. Solo `create-pos-payment.dto.ts` acepta `fulfillment_destination`.
  - **B6:** en mesa, "Enviar a cocina" con un plato y una gaseosa falla entero con `KITCHEN_FIRE_NOT_ELIGIBLE_001`, porque la gaseosa `stock` lleva `skip_kds=true`.
  - **B7:** una línea preparada `stock`/`production` de mesa o de cambio de ítem nunca se puede entregar (`order-action-policy.util.ts:760`).
  - **B8:** con stock parcial, el POS muestra "Del stock" y el servidor manda la línea a Producción (`cart.model.ts:505` frente a `available >= quantity`).

  Advertencias:
  - **A1:** `start()` de programados consume la receta de líneas `production`/`stock`, pendiente de L4. Entra en la corrección.
  - **A2:** el enum no está en `REQUIRED_ENUM_TYPES`. Entra en la corrección.
  - **A3–A9:** advertencias que no se corrigen.

  Las sondas del verificador se guardaron en el scratchpad (`t12-probes/`) y su worktree se eliminó. Plan, según la regla de corrección: un único lote corrige B1–B8, A1 y A2. Va después del commit de T13, porque comparte archivos con su escritor backend. Después, una sola recomprobación limitada a esos puntos.
- L21 (2026-11-09, T13 integración): los dos escritores entregaron.
  - **Backend.** Migración aditiva `20261126090000_production_order_sale_link`. Lo nuevo:
    - `ProductionSaleLinkService` con `ensureForOrder` idempotente, disparado por el evento esperado `production.sale_sync` tras el commit en POS, ecommerce, mesa, cambios de ítem y crear/editar orden.
    - Guard atómico `PRODUCTION_ORDER_CONCURRENT_UPDATE`.
    - Adiciones reclamadas una vez al completar.
    - Reserva `min(producido, planeado)`.
    - En la entrega, una línea `production` con orden completada consume y descuenta una vez.
    - El arranque de un programado excluye las líneas ligadas.
    - `cancelOrder` emite `production.sale_cancelled` antes del barrido de reservas, y `productionDisposition` es opcional con sugerencia.

    Salvedad del escritor: escribió los specs después del código, así que no hay RED propio. El verificador independiente lo compensa con sondas.
  - **Frontend.** Vista compartida `ProductionOrderDetailComponent` con su modal, ruta `orders/:id`, chip y estado en el detalle de la orden, aviso no bloqueante al cancelar, modal del programado, Lista de producción y bloque "Pedido de venta" en Planta. Desvío de superficie aceptado: `manufacturing/interfaces/manufacturing.interface.ts` (campo aditivo).
  - **Ajustes inline del orquestador:**
    - `productionDisposition` en `FlowCancelOrderDto`.
    - El detalle del pedido programado devuelve `production_order` por línea. RED trivial en la base: el campo no existía. `scheduled-orders.service` 18/18.
    - Mock `updateMany` en `partial-batch.spec` (Planta, 2/2).
    - **Asiento de la merma.** El escritor bajaba stock (`damage`) sin asiento. Ahora `production.sale_waste` registra DR `inventory.adjusted.shrinkage` (5295) / CR `production.completed.finished_goods` (1435), con `source_id` = orden de producción. Reutiliza llaves existentes, sin mapping nuevo ni seed.
    - Guard para no liberar ni dar de baja dos veces cuando todas las líneas ya están `inventory_committed`.
    - RED observado: `production-sale-link` 2 fallos → 18/18; `auto-entry` 2 fallos → 45/45.
  - **Auditoría de singletons:** OK. `production.module.ts` importa `OrderStockCommitModule`, `RecipesModule` y `S3Module`; no hay ciclo (`OrderStockCommitModule` no importa producción).
  - **Fuera de alcance, anotado:** la entrega por remisión (dispatch note) no consume la reserva de producción; la limpia el barrido.
- L22 (2026-11-09, T12 lote de corrección): un escritor sonnet corrigió B1, B2, B3, B4, B6, B7, B8, A1 y A2; A3–A9 quedan como avisos. Hay RED→GREEN por bloqueo, comprobado contra el archivo de HEAD. Verdes: option-pricing 15/15, line-destination.loader 9/9, orders.service 204/204, order-item-changes 75/75, checkout 75/75, table-sessions 107/107, kitchen-fire.service 115/115, order-action-policy 211/211, order-stock-commit 33/33 (repetido por el padre), scheduled-order-production 28/28, payments 201/201 y draft-options 6/6. `payments.service.shipping-tax.spec` ya fallaba 38/38 en HEAD (su mock no tiene `order_item_options`); es un aviso preexistente. Cambio de módulo: `order-stock-commit.module` importa `RecipesModule`; el audit de singleton da OK y no hay ciclo. En la auditoría el padre encontró una regresión que causaba la propia corrección: B2 hace que la elección del cliente gane sobre el destino guardado, pero `loadFromOrder` no recuperaba `fulfillmentChoice`. Una línea guardada «A producción» volvía al servidor como «Del stock». El padre lo corrigió inline en `pos-cart.service.mapOrderItemToCartItem`. Riesgos abiertos fuera de alcance: `ProductOptionsService.isEnabled` sigue exigiendo que los pedidos programados estén activos; `pos-checkout-shell` no envía el destino al crear la orden de mesa; el DTO de mesa también lo acepta desde el QR del comensal; el costo de las adiciones de stock entra al COGS de la venta.
- L23 (2026-11-09, T14/T15 mapa): un explorador sonnet mapeó las vistas. Hallazgos:
  - La lista de producción de Pedidos programados no usa el patrón estándar y hereda la llave `orders_scheduled` (solo restaurante): es la causa probable del redirect al POS.
  - El `start()` de restaurante no guarda `started_at`.
  - No hay filtro por fecha ni columna de tiempo estimado; la única fuente de tiempo es `products.preparation_time_minutes`.
  - Ninguna operación de producción emite SSE.
  - Los títulos ya tienen entrada en `breadcrumb.service` (`:775`, `:781`); "Panel Principal" es el fallback de una ruta sin entrada.

  Decisión: T14 trae el endpoint del día y la vista compartida; T15 trae el tiempo estimado, el inicio con hora, la tarjeta por venta, el SSE y la Producción activa (contratos en S14/S15). Se arranca tras cerrar la verificación de T13.
- L24 (2026-11-09, T13 verificación independiente): el verificador encontró 3 bloqueos, corregidos inline con RED primero en c0904a51b:
  - B1: `ensureForOrder` no revivía una orden de producción cancelada; la venta reeditada quedaba sin producción. Ahora la pasa a `draft` con la cantidad y la entrega nuevas, y `started_at` en null.
  - B2: el job de pago vencido (2 h) y el fallo al registrar el pago del checkout ecommerce cancelaban la venta sin emitir `production.sale_cancelled`. Ahora lo emiten con `disposition: 'release'`; un fallo del evento no rompe la cancelación.
  - B3: «Dar de baja como merma» daba de baja todo lo producido, aunque solo una parte siguiera reservada para la orden. Ahora libera la reserva y da de baja solo lo liberado; sin reserva no hay baja.
  - Verdes: production-sale-link 22/22, payment-timeout-cleanup 4/4, checkout 76/76.
  - Aviso: una cancelación hecha en Planta sobre una orden ligada se revive en la siguiente sincronización de la venta.
- L25 (2026-11-09, T14): el backend `findDay` y su spec se hicieron inline, con RED 7/7 → GREEN 7/7 y production-orders.service 31/31. El frontend lo escribió un escritor sonnet. El padre auditó su diff y corrigió:
  - En Planta, la lista dejaba iniciar una orden `draft` con el endpoint de restaurante y se saltaba «liberar». Ahora la ruta de Planta lleva `manageInline: false`: sin acciones en la lista, y cada orden abre su detalle de Planta.
  - El endpoint del día ahora también acepta `store:manufacturing:orders:read`.
  - Se recuperó la página de insumos consolidados e impresión en `production/insumos`, que había quedado huérfana.
  - "Iniciar producción del día" se oculta hasta que T15 cree la Producción activa, para no dejar un enlace muerto.
  - Aviso preexistente: la tabla es compartida y el `start()` de restaurante acepta cualquier `draft`, también uno de Planta, si la tienda usa ambos módulos.
  - El redirect al POS de la URL directa no tiene una causa en el mapeo de rutas: depende del guard y de los datos de la tienda, y requiere verificación en ejecución.
- L26 (2026-11-09, recomprobación T12+T13): un verificador independiente (Opus) revisó solo los bloqueos en c0904a51b, con sondas en un worktree temporal. Los 14 están corregidos: T12 B1–B4, B6–B8, A1, A2 y el arreglo de `loadFromOrder`; T13 B1–B3. Cada sonda nueva falla con el código anterior a su corrección (p1b, p6b y t13-recheck). Los specs del repositorio pasan: option-pricing 15/15, draft-options 6/6, line-destination.loader 9/9, orders 204/204, checkout 76/76, table-sessions 107/107, item-changes 75/75, kitchen-fire 115/115, order-action-policy 211/211, scheduled-order-production 28/28, order-stock-commit 33/33, production-sale-link 22/22 y payment-timeout-cleanup 4/4. Avisos nuevos, que no bloquean:
  1. Decisión de producto pendiente para Rafael: una cancelación manual desde Planta o Producción, sobre una línea de venta que sigue en `production`, se revive con la siguiente escritura sobre la venta.
  2. Una línea `stock` y una `production` del mismo producto en la misma orden comparten la clave de reserva. Con entrega parcial y merma, la baja puede tomar una unidad de la línea `stock`.
  3. B8 en pantalla: en productos por peso, el POS compara la cantidad y el servidor el peso. Al editar, el POS no cuenta la reserva propia de la orden; el chip puede decir «A producción» mientras el servidor mantiene «Del stock». El servidor decide bien; lo que falla es lo que se ve.
- L27 (2026-11-09, T15): el padre escribió inline la migración aditiva `20261127090000_production_order_estimated_minutes` (`estimated_minutes INTEGER`, `-- DATA IMPACT: none`, idempotente), el campo en `schema.prisma` y la entrada en `assert-schema-columns.js`. No se aplicó a la DB local: el contenedor monta el checkout principal y quedaría con drift. Dos escritores sonnet trabajaron en paralelo.
  - **Backend.** Tiempo estimado editable por PATCH, con valor efectivo en lectura. `start()` guarda `started_at` con claim atómico. `POST sale/:orderId/start|complete` devuelve `{moved, skipped, failed}`. Hay un `ProductionSseService` propio y un helper único `emitProductionOrderUpdated`, emitido tras el commit en producción, en el enlace con la venta y en Planta.
  - **Frontend.** `ProductionSseService` con conexión compartida por conteo de referencias, debounce de 300 ms, backoff y polling de respaldo. Página Producción activa con un ticker de 1 s: cuenta regresiva, luego «Tiempo excedido», o cuenta hacia arriba si no hay estimado. Edita el estimado e inicia o finaliza por orden y por tarjeta. «Iniciar producción del día» queda conectado en las tres rutas. Recargan en vivo: la agenda, el detalle del programado, las dos listas y los dos detalles.
  - **Desvíos aceptados:**
    - `estimated_minutes` del evento es el override crudo; los consumidores recargan del endpoint.
    - Finalizar en Planta emite el evento dos veces; inofensivo, el debounce lo absorbe.
    - En Planta: `released` inicia con el endpoint de manufactura, «Finalizar» abre el detalle de Planta (lote y cantidad) y el estimado no se edita.
  - **Bloqueo encontrado en la auditoría del padre y corregido inline (RED 4 → GREEN 4).** El controlador `store/production-orders` lleva `@IndustryModule('restaurant_ops_production')`, que siempre se exige (VERTICAL). Una tienda solo de manufactura recibía 403 en `day` y `stream`; afectaba también la ruta de Planta de T14.
    - Planta expone ahora `GET store/manufacturing/orders/day` y `@Sse store/manufacturing/orders/stream`, bajo su propio guard `manufacturing_orders` y con permiso `store:manufacturing:orders:read`.
    - Reutilizan `ProductionOrdersService.findDay` y `ProductionSseService.stream`, que se extrajo del controlador de producción.
    - El frontend elige el API con `apiScope: 'manufacturing'` en las rutas de Planta (`getDay(date, scope)` y `listen(..., scope)`).
    - No se tocó el mapa de industrias ni los guards.
  - Avisos: el cronómetro usa el reloj del cliente contra `started_at`, así que un equipo desfasado muestra el desfase. Los offsets sticky del móvil no se vieron renderizados.
- L28 (2026-11-09, RDD T12–T15): el rango completo (7.508 líneas) superó el presupuesto de contexto del revisor (`lens_context_budget_exceeded`) y se revisó por candidatos. Rafael concedió revisión en cada uno. Lentes: risk y reliability; ítem 1 en todos, salvo T14 y T15b (ítem 2).
  - **Aprobados y reconocidos (autoridad quemada):**

    | Candidato | Rango | Lineage |
    |---|---|---|
    | T12 | 30fd00a26..b8634d087 | review-94b1c3158f7a625a |
    | Corrección de T12 | 23e9ad0c6..9940ea66a | review-8a15a7a9a5d23865 |
    | Corrección de T13 | 9940ea66a..c0904a51b | review-05d9a1cf6f7ffac3 |
    | T14 | c0904a51b..1f4c4a458 | review-2611da0c7955c85d |

  - **Divididos en commits temporales**, en el worktree de revisión y no en la rama. El último commit de cada cadena tiene un árbol idéntico al commit real.

    | Candidato | Parte | Lineage |
    |---|---|---|
    | T13 (3.121 líneas, superó el presupuesto) | núcleo backend + migración, 1.441 líneas | review-1e70c21aa1f629f1 |
    | | integraciones backend, 626 líneas | review-8e4b34022de9d138 |
    | | frontend, 1.054 líneas | review-f603c948e9623179 |
    | T15 | backend + migración, 1.218 líneas | review-d6be812a6cd54c76 |
    | | frontend, 1.399 líneas | review-64b891b13181a7de |

  - Ningún hallazgo bloqueó. Todos son informativos.
  - **Corregido por el padre, RED → GREEN:**
    - 47f76c025: si falla la firma S3 de una imagen, el detalle sigue cargando y esa imagen queda en null. Spec production-orders.service 32/32 (RED 1).
    - bd0e037ab:
      - `estimated_minutes` con `@Max(10080)`, el mismo rango que `preparation_time_minutes`; fuera de rango da 400 y no 500. Spec production-order.dto 4/4 (RED 1). El frontend valida el mismo rango.
      - Una recarga en segundo plano que falla ya no borra la lista ni el tablero.
      - El SSE compartido pasa al stream de Planta mientras escucha una página de Planta.
    - Slice 6311b4ce1..bd0e037ab: medio, `under_budget` (129 líneas), sin revisión debida.
  - **Descartados tras verificarlos en el código:**
    - El permiso dual del día es OR: `permissions.guard.ts:96` usa `some`.
    - `req.on('close')` es el patrón vigente del repositorio (table-sessions, invoice-data).
    - `RecipesModule` exporta `RecipesService`.
    - La cancelación del checkout no está condicionada al estado: el `updateMany` siempre cancela, así que el evento es correcto.
    - Hallazgos de las partes que dependen de otra parte («nadie emite la sincronización») son artefactos de la división.
  - **Avisos abiertos para después:**
    - (a) La disposición sugerida se calcula una vez para toda la venta: una línea personalizada sugiere merma también para productos simples. Es solo sugerencia; el operador elige.
    - (b) Un cancelado desde Planta revive con la siguiente sincronización de la venta. Ya estaba en L26 como decisión de producto para Rafael.
    - (c) `findDay` corta en 500 filas sin avisar.
    - (d) La ruta de producción de Pedidos programados ahora exige el permiso de lectura de producción o manufactura.
    - (e) startSale/completeSale responden éxito aunque todo falle. El frontend sí muestra los `failed` como error.
    - (f) El token del SSE va en query string, igual que el KDS.
    - (g) El modo manual del SSE solo vuelve a vivo con `reconnect()`.
    - (h) Carrera de recarga en el detalle si cambia el `:id` en la misma instancia.
    - (i) Faltan specs del frontend (temporizador, SSE). Karma está prohibido en desarrollo.
    - (j) Líneas legacy (destino NULL) de un borrador con adiciones cobrado sin programación.
- L29 (2026-11-09, cierre): T1–T15 hechos en `feat/flujo-produccion`, con un commit por ticket más sus correcciones (14 bloqueos de verificadores y 4 avisos RDD corregidos). Toda la rama tiene RDD aprobada salvo el slice final `under_budget`.
  - Pendiente de entorno:
    - Correr la migración 20261127090000 en la DB local o de staging. No se aplicó porque el contenedor monta el checkout principal.
    - Probar en runtime el POS, Producción activa y Planta.
    - Compilar el frontend, que queda para CI.
  - Push y PR quedan a pedido de Rafael.

