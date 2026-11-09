# Flujo de producción (QUI-988 a QUI-1002)

Objetivo: implementar uno a uno los 15 tickets consolidados el 2026-11-09 (repostería/restaurante: producción, pedidos programados, adiciones, KDS). Rama `feat/flujo-produccion` (worktree `../Vendix-produccion`, base `origin/develop` 5ba3d56c6), un commit por ticket. Entrega: commits locales; push/PR solo si Rafael lo pide. Runner backend: `cd apps/backend && npx jest --runInBand <spec>` (un spec por vez, nunca dos jest a la vez). Frontend: sin `ng test`; verificación por revisión de diff (UI en vhost pendiente: el vhost sirve el checkout principal).

## Specs

Cada S# es un ticket de Linear. El texto literal completo (historia, pasos, criterios, citas de Rafael y notas técnicas) está en Linear y en la copia local `/private/tmp/claude-501/-Users-rzy-Documents-Organizations-Quickss-Vendix/afd3ecc7-ae95-4ff1-ae04-69c7ed628463/scratchpad/tickets/QUI-<n>.md`. Los criterios se copian aquí sin resumir.

### S1 — QUI-988 · FIX/ Insumo repetido en la receta descuenta stock una sola vez [api]

Ticket: https://linear.app/quickss/issue/QUI-988 · copia: `/private/tmp/claude-501/-Users-rzy-Documents-Organizations-Quickss-Vendix/afd3ecc7-ae95-4ff1-ae04-69c7ed628463/scratchpad/tickets/QUI-988.md`

- [ ] El stock baja la suma de todos los movimientos del insumo (240 g de azúcar y 200 ml de leche en el ejemplo).
- [ ] Tras la venta, los movimientos y el stock de cada insumo cuadran.
- [ ] Un plato sin insumos repetidos sigue descontando igual que hoy.

### S2 — QUI-989 · FIX/ Pedido programado se manda a cocina y gasta la receta al cobrar [api]

Ticket: https://linear.app/quickss/issue/QUI-989 · copia: `/private/tmp/claude-501/-Users-rzy-Documents-Organizations-Quickss-Vendix/afd3ecc7-ae95-4ff1-ae04-69c7ed628463/scratchpad/tickets/QUI-989.md`

- [ ] Al cobrar un pedido programado no se manda a cocina ni se mueve ningún insumo.
- [ ] Un plato programado no va a cocina al cobrar. Si es producible, va a Producción o reserva stock, según elija el cajero. Si no es producible, se manda a KDS el día del pedido con "Enviar a cocina" desde la agenda, y la receta y las adiciones se descuentan en ese momento.
- [ ] Las ventas no programadas siguen la matriz de [QUI-999](https://linear.app/quickss/issue/QUI-999/feat-linea-divisoria-entre-kds-y-produccion-visible-en-la-orden): los platos sin "Producido en lote" van a cocina al cobrar, como hoy.

### S3 — QUI-990 · FIX/ La venta no usa el stock de preparaciones hechas por lote [api]

Ticket: https://linear.app/quickss/issue/QUI-990 · copia: `/private/tmp/claude-501/-Users-rzy-Documents-Organizations-Quickss-Vendix/afd3ecc7-ae95-4ff1-ae04-69c7ed628463/scratchpad/tickets/QUI-990.md`

- [ ] El Bizcocho baja de 4 a 3 y sus insumos no se mueven.
- [ ] Las preparaciones que no se producen por lote siguen descontando su receta, como hoy.
- [ ] Sin stock de la preparación por lote, la venta genera su producción: se hace como parte del pedido y sus insumos se descuentan donde se consuma la línea (al vender si sale del stock, al mandar a cocina o al iniciar producción). Solo bloquea si faltan insumos (regla sin sobreventa).
- [ ] Con stock parcial, usa lo que hay y produce lo que falta (inferido).

### S4 — QUI-1001 · FEAT/ Adiciones y pedidos programados solo para restaurante [api][admin]

Ticket: https://linear.app/quickss/issue/QUI-1001 · copia: `/private/tmp/claude-501/-Users-rzy-Documents-Organizations-Quickss-Vendix/afd3ecc7-ae95-4ff1-ae04-69c7ed628463/scratchpad/tickets/QUI-1001.md`

- [ ] En tiendas que no son restaurante no se ven: el submódulo y la acción Adiciones, el selector de adiciones del POS y del ecommerce, Pedidos programados (agenda, lista de producción y ajustes), Producción ni KDS.
- [ ] La URL directa de esos módulos redirige igual que cualquier módulo oculto.
- [ ] En tiendas restaurante todo sigue visible como hoy.
- [ ] Esconder no borra datos.
- [ ] Antes de desplegar se cuenta cuántas tiendas de otras industrias usan hoy adiciones o pedidos programados, y se avisa si hay alguna.

### S5 — QUI-992 · FIX/ Cobro bloqueado con "Configure la caja para continuar" tras reingresar [admin]

Ticket: https://linear.app/quickss/issue/QUI-992 · copia: `/private/tmp/claude-501/-Users-rzy-Documents-Organizations-Quickss-Vendix/afd3ecc7-ae95-4ff1-ae04-69c7ed628463/scratchpad/tickets/QUI-992.md`

- [ ] Con una caja abierta, el cobro funciona después de reingresar.
- [ ] Si falta elegir la caja, el POS ofrece elegirla en pantalla.

### S6 — QUI-998 · FIX/ Recargar tras guardar configuración de usuario abre el panel de organización [admin]

Ticket: https://linear.app/quickss/issue/QUI-998 · copia: `/private/tmp/claude-501/-Users-rzy-Documents-Organizations-Quickss-Vendix/afd3ecc7-ae95-4ff1-ae04-69c7ed628463/scratchpad/tickets/QUI-998.md`

- [ ] Después de guardar la configuración y recargar, sigo en la tienda.
- [ ] El módulo activado aparece en el menú.
- [ ] No aparecen errores 403.

### S7 — QUI-991 · FIX/ Agenda y lista de producción no muestran dedicatoria, cliente ni productos [admin]

Ticket: https://linear.app/quickss/issue/QUI-991 · copia: `/private/tmp/claude-501/-Users-rzy-Documents-Organizations-Quickss-Vendix/afd3ecc7-ae95-4ff1-ae04-69c7ed628463/scratchpad/tickets/QUI-991.md`

- [ ] El detalle del pedido muestra el nombre de la clienta.
- [ ] El detalle lista los productos con sus adiciones y la nota de cada línea.
- [ ] La lista de producción muestra la nota (dedicatoria) de cada línea.
- [ ] Las cantidades salen en español ("1 und").

### S8 — QUI-997 · FIX/ Detalles de UI en adiciones, producción, POS y recibo [admin]

Ticket: https://linear.app/quickss/issue/QUI-997 · copia: `/private/tmp/claude-501/-Users-rzy-Documents-Organizations-Quickss-Vendix/afd3ecc7-ae95-4ff1-ae04-69c7ed628463/scratchpad/tickets/QUI-997.md`

- [ ] El recibo muestra la hora en 24 horas o con a. m./p. m.
- [ ] Cada página tiene su título propio.
- [ ] Producción muestra la unidad real y plurales correctos.
- [ ] "Completadas (mes)" cuenta solo las del mes en curso.
- [ ] El selector de componentes filtra por los tipos que admite una receta.
- [ ] "Iniciar Inventario" queda deshabilitado con explicación, o funciona, antes de guardar.
- [ ] El cliente rápido de consumidor final no exige datos tributarios.
- [ ] El contador de módulos nuevos refleja un número real.

### S9 — QUI-993 · FEAT/ Grupos de adiciones con buscador de insumo, producto o preparación [admin]

Ticket: https://linear.app/quickss/issue/QUI-993 · copia: `/private/tmp/claude-501/-Users-rzy-Documents-Organizations-Quickss-Vendix/afd3ecc7-ae95-4ff1-ae04-69c7ed628463/scratchpad/tickets/QUI-993.md`

- [ ] "Adiciones" es un submódulo de Productos, debajo de Marcas, y ya no está en el menú de acciones del listado de productos.
- [ ] Al agregar una adición solo se ve el buscador; los campos aparecen después de elegir el producto.
- [ ] Los campos vienen precargados con los datos del producto y se pueden personalizar.
- [ ] Cada adición del grupo muestra la imagen del producto.
- [ ] Los grupos y adiciones que ya existen siguen funcionando igual.
- [ ] El submódulo se puede mostrar u ocultar por panel, como Marcas.
- [ ] La página se titula "Grupos de adiciones" (hoy dice "Detalles del Producto").

### S10 — QUI-994 · FEAT/ Nota e imagen por adición en el POS, visibles en carrito y recibo [admin]

Ticket: https://linear.app/quickss/issue/QUI-994 · copia: `/private/tmp/claude-501/-Users-rzy-Documents-Organizations-Quickss-Vendix/afd3ecc7-ae95-4ff1-ae04-69c7ed628463/scratchpad/tickets/QUI-994.md`

- [ ] Cada adición del selector muestra la imagen del producto (o un ícono si no tiene).
- [ ] Cada adición elegida admite una nota, igual que la nota del producto.
- [ ] La línea del carrito lista las adiciones con sus notas (hoy solo dice "Base: $95.000").
- [ ] El recibo muestra las adiciones, sus notas y la nota de la línea.
- [ ] El detalle del pedido programado y la lista de producción muestran las notas de cada adición.
- [ ] Una venta con adiciones sin nota funciona igual que hoy.
- [ ] El botón de cerrar del modal de adiciones muestra su ícono (hoy es un círculo gris vacío).

### S11 — QUI-1000 · FEAT/ KDS con flujo de adiciones como Producción [api][admin]

Ticket: https://linear.app/quickss/issue/QUI-1000 · copia: `/private/tmp/claude-501/-Users-rzy-Documents-Organizations-Quickss-Vendix/afd3ecc7-ae95-4ff1-ae04-69c7ed628463/scratchpad/tickets/QUI-1000.md`

- [ ] El ticket de KDS lista las adiciones de cada plato con cantidad, imagen y nota.
- [ ] Desde el ticket se ve la receta del plato y la de las preparaciones de las adiciones, igual que en Producción.
- [ ] Al mandar a cocina también se descuentan los componentes de las adiciones, una sola vez.
- [ ] Un plato sin adiciones se ve y descuenta igual que hoy.
- [ ] Al KDS solo llegan platos sin "Producido en lote": los vendidos para ya, al cobrar, y los programados, cuando se envían desde la agenda el día del pedido. Un plato en lote, tenga o no adiciones, nunca llega al KDS.
- [ ] Si a la receta le falta stock de una preparación por lote, al mandar a cocina se descuentan los insumos de esa preparación ([QUI-990](https://linear.app/quickss/issue/QUI-990/fix-la-venta-no-usa-el-stock-de-preparaciones-hechas-por-lote-api)).

### S12 — QUI-999 · FEAT/ Línea divisoria entre KDS y Producción, visible en la orden [api][admin]

Ticket: https://linear.app/quickss/issue/QUI-999 · copia: `/private/tmp/claude-501/-Users-rzy-Documents-Organizations-Quickss-Vendix/afd3ecc7-ae95-4ff1-ae04-69c7ed628463/scratchpad/tickets/QUI-999.md`

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

Ticket: https://linear.app/quickss/issue/QUI-995 · copia: `/private/tmp/claude-501/-Users-rzy-Documents-Organizations-Quickss-Vendix/afd3ecc7-ae95-4ff1-ae04-69c7ed628463/scratchpad/tickets/QUI-995.md`

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

### S14 — QUI-996 · FEAT/ Rediseño de Pedidos programados: agenda y producción en línea de tiempo [admin]

Ticket: https://linear.app/quickss/issue/QUI-996 · copia: `/private/tmp/claude-501/-Users-rzy-Documents-Organizations-Quickss-Vendix/afd3ecc7-ae95-4ff1-ae04-69c7ed628463/scratchpad/tickets/QUI-996.md`

- [ ] La agenda y la lista de producción siguen el patrón estándar de módulos de Vendix (resumen, encabezado fijo, vista adaptable) y su lenguaje visual.
- [ ] La lista de producción es una línea de tiempo, con enlace directo a la orden de producción y acciones de gestión.
- [ ] La lista de producción tiene filtro por día y el botón "Iniciar producción del día", que abre la Producción activa ([QUI-1002](https://linear.app/quickss/issue/QUI-1002/feat-produccion-activa-timeline-del-dia-con-cronometro-apiadmin)).
- [ ] La lista de producción no es exclusiva de pedidos programados: es la misma vista en Operaciones → Producción (restaurante) y en Planta (manufactura).
- [ ] Los títulos son correctos: hoy dicen "Panel Principal" y "Ordenes de Venta".
- [ ] Las dos páginas funcionan bien en móvil.
- [ ] La URL directa de la lista de producción ya no redirige al POS.

### S15 — QUI-1002 · FEAT/ Producción activa: timeline del día con cronómetro [api][admin]

Ticket: https://linear.app/quickss/issue/QUI-1002 · copia: `/private/tmp/claude-501/-Users-rzy-Documents-Organizations-Quickss-Vendix/afd3ecc7-ae95-4ff1-ae04-69c7ed628463/scratchpad/tickets/QUI-1002.md`

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

## Tasks

| ID | Spec | Ticket | Ruta | Estado | Commit / evidencia |
| -- | -- | -- | -- | -- | -- |
| T1 | S1 | QUI-988 | delegado (sonnet) | hecho | kitchen-fire.service.spec 101/101 (RED 720≠520 → GREEN) |
| T2 | S2 | QUI-989 | delegado (sonnet) | pendiente | |
| T3 | S3 | QUI-990 | delegado (sonnet) | pendiente | |
| T4 | S4 | QUI-1001 | delegado (sonnet) | pendiente | |
| T5 | S5 | QUI-992 | delegado (sonnet) | pendiente | |
| T6 | S6 | QUI-998 | delegado (sonnet) | pendiente | |
| T7 | S7 | QUI-991 | delegado (sonnet) | pendiente | |
| T8 | S8 | QUI-997 | delegado (sonnet) | pendiente | |
| T9 | S9 | QUI-993 | delegado (sonnet) | pendiente | |
| T10 | S10 | QUI-994 | delegado (sonnet) | pendiente | |
| T11 | S11 | QUI-1000 | delegado (sonnet) | pendiente | |
| T12 | S12 | QUI-999 | delegado (sonnet) | pendiente | |
| T13 | S13 | QUI-995 | delegado (sonnet) | pendiente | |
| T14 | S14 | QUI-996 | delegado (sonnet) | pendiente | |
| T15 | S15 | QUI-1002 | delegado (sonnet) | pendiente | |

Ruta: un escritor Sonnet por ticket, en serie (Writer trigger: backstop de contexto, 15 unidades en una sesión). El orquestador (Opus) audita el diff, corre el spec del cambio y commitea. Verificador independiente en unidades de alto riesgo (stock, migraciones).

## Log

- L1 (2026-11-09, Rafael, literal): "QUIERO QUE EJECUTES TODOS LOS TICKET CON TODOS SUS PLANES 1 A 1 TODOS A UNA SOLA RAMA COMIT POR COMIT CADA UNO AVANZANDO HACIA LA CONSOLIDACION DE EL FLUJO DE PRODUCCION HASTA LOGRAR EL 100% DE LOS TICKETS QUE ACABAMOS DE CONSOLIDAR SU ANALISIS"
- L2 (2026-11-09): L1 autoriza la ejecución sin aprobación adicional del plan. Orden por dependencia: fixes de consumo (988, 989, 990), visibilidad (1001), fixes de UI/POS (992, 998, 991, 997), adiciones (993, 994), KDS (1000), matriz (999), producción ligada (995), agenda (996), producción activa (1002). Las decisiones de producto ya están cerradas en los tickets (matriz QUI-999, tarjeta por pedido, reserva al producir, cancelar → preguntar stock o merma).
