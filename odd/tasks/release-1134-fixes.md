# Release #1134: hallazgos y pendientes del flujo de producción

Objetivo: corregir los 4 hallazgos medios y los 11 bajos del release review de #1134, y cerrar los avisos que el flujo de producción dejó abiertos. Ningún comercio que no use Producción debe notar un cambio.
Rama: `fix/release-1134-hallazgos`, creada desde `origin/develop` (1fc2dcfa7) en el worktree `Vendix-release-fixes`. Entrega: 3 PR encadenados a develop. Cada PR debe pasar el gate `pr-code-review` con ≥85. Después viene un release a main con release review >85 y sin hallazgos altos.
Runner: backend `npx jest -c jest.isolated.config.js --rootDir src <spec>`, un spec por vez. Cada spec nuevo de frontend se añade a la lista `--include` de karma en `ci.yml`. El frontend se verifica en CI y con Playwright contra el vhost.

## Specs

### Bloque 1: dinero, stock y producción (PR 1)

#### S1. Cancelar con "Merma" cancela la venta y avisa si el ajuste falla (M1)
Como cajero de un restaurante con Producción, quiero que la venta se cancele aunque falle el ajuste de producción y que lo producido no vuelva a vendible, para que el inventario no muestre como vendible lo que se botó.

- **Pasos:**
  1. Vender un plato "Producido en lote".
  2. Completar su orden de producción.
  3. Cancelar la venta eligiendo "Merma". En la prueba, forzar que falle el ajuste de producción.
- **Criterios:**
  - La venta queda cancelada.
  - Si el ajuste falla, lo producido sigue reservado y no aparece como disponible para vender.
  - La respuesta de la cancelación trae un aviso y la pantalla lo muestra. Texto propuesto: "La venta se canceló, pero lo producido no se pudo ajustar. Ajústalo desde la orden de producción {número}."
  - Si el ajuste no falla, el comportamiento es el de hoy.
- **Notas:**
  - Hoy `requestProductionSaleSync` se traga el error (`order-flow.service.ts:8137-8164`, `production-sale-link.service.ts:101-112`).
  - Después corre `releaseReservationsByReference('order', …)`, que devuelve también la reserva de lo producido.
  - El arreglo: cuando el ajuste falla, la liberación general excluye las reservas de las órdenes de producción ligadas, y el fallo se propaga como `warnings` en la respuesta.
- **Riesgo:** ítem 1 (reservas de stock).

#### S2. Las entregas parciales de Planta reservan en total como máximo lo planeado (M2)
Como jefe de Planta, quiero que varias entregas parciales de una orden ligada a una venta reserven en total solo lo que la venta pidió, para que no quede stock bloqueado sin dueño.

- **Pasos:**
  1. Hacer una venta de 10 unidades con su orden ligada.
  2. Hacer dos entregas parciales de 6 desde Planta.
  3. Cancelar la venta.
- **Criterios:**
  - Lo reservado para la venta queda en 10, no en 12.
  - Al cancelar no queda ninguna reserva colgada.
- **Notas:**
  - `settleProducedForSale` (`production-orders.service.ts:1081-1146`) reserva `min(produced_qty de esta entrega, planned)` en cada entrega.
  - La liberación (`production-sale-link.service.ts:190`) usa `min(acumulado, planned)`.
  - El arreglo: reservar de forma incremental, `min(acumulado, planned) − ya reservado`.
- **Riesgo:** ítem 1.

#### S3. Si una adición de una línea "Del stock" no tiene existencias, el cobro se bloquea y nombra la adición (M3)
Como cajero, quiero que al cobrar el mensaje diga qué adición no tiene existencias, para corregirla sin adivinar.

- **Pasos:** tomar un producto con stock y una adición sin existencias, ponerlo como línea "Del stock" y cobrar.
- **Criterios:**
  - El cobro se bloquea, como hoy.
  - El mensaje nombra la adición con el mismo formato de la regla del dueño sobre la sobreventa.
- **Notas:** `order-stock-commit.service.ts:578-600` llama a `updateStock` con `validate_availability`, que hoy lanza el genérico `Insufficient stock available` (`stock-level-manager.service.ts:228`).

#### S4. El costo de venta de los comercios existentes es idéntico al de main (B1)
Como dueño de cualquier comercio, quiero que el costo de venta que se asienta al entregar sea exactamente el de antes del release, para que la contabilidad no cambie por una función que no uso.

- **Criterios:**
  - Sin costo de producción, `order.completed` lleva `commit.totalCost` tal cual, sin `toFixed(4)`.
  - Con producción, la resta sigue igual que hoy.
- **Notas:** `order-flow.service.ts:1203-1240`, función `emitDeliveryCogs`.

#### S5. Una venta sin líneas de Producción no abre trabajo de Producción (B3)
Como dueño de un comercio que no usa Producción, quiero que cobrar no haga consultas ni transacciones de Producción, para que el POS no se vuelva más lento.

- **Criterios:**
  - `ensureForOrder` sale antes de abrir la transacción cuando la venta no tiene líneas `production` vivas ni órdenes ligadas.
  - Una venta con Producción sigue igual que hoy.
- **Notas:** `production-sale-link.service.ts:296-372`. Lo llaman `payments.service.ts:2814`, `orders.service.ts:1187/3863/5840`, `table-sessions.service.ts:1248` y `checkout.service.ts:2792`.

#### S6. Al cancelar, se elige Merma o Liberar por producto, con Liberar preseleccionado (decisión de Rafael)
Como cajero, al cancelar una venta con varias órdenes de producción completadas, quiero elegir Merma o Liberar en cada producto, con Liberar ya marcado y la sugerencia visible por producto, para reusar lo que sirve y botar solo lo personalizado.

- **Pasos:**
  1. Hacer una venta con dos productos producidos: uno simple y otro con nota o adiciones.
  2. Completar las dos órdenes.
  3. Cancelar la venta.
- **Criterios:**
  - El modal de cancelación lista cada producto producido con su elección, y todos empiezan en "Liberar".
  - Junto al producto personalizado aparece "Sugerido: Merma". El producto simple no muestra sugerencia.
  - Cada elección se aplica a su orden de producción.
  - Si la petición no trae elección, el servidor aplica Liberar a todo. Hoy aplica merma si alguna línea es personalizada (`flujo-produccion.md:197`).
- **Notas:**
  - `CancelOrderDto` gana un campo opcional por orden de producción: `productionDispositions: { production_order_id, disposition }[]`.
  - `productionDisposition`, el campo único, sigue funcionando como valor para todas.
  - La sugerencia se calcula por orden de producción, no por venta. Este era el aviso (a) del cierre de #1132.
- **Riesgo:** ítem 1.

#### S7. Las fracciones descuentan igual vengan de cocina o de producción: se suma y luego se redondea (R3-003, decisión de Rafael)
Como dueño de una repostería que vende por fracciones, quiero que una venta descuente los insumos de la misma forma la mande a cocina (KDS) o a producción, para que el inventario no dependa de quién preparó.

- **Pasos:**
  1. Hacer una venta con dos líneas de 0,5 del mismo plato.
  2. Mandarla por KDS en una tienda.
  3. Hacer la misma venta por inicio de producción en otra.
- **Criterios:** el total descontado para la venta es la receta de `redondeo(suma de cantidades)` en ambos caminos. En el ejemplo, una receta en los dos.
- **Notas:**
  - Hoy el disparo a cocina redondea por línea y el inicio de producción consolida antes de redondear.
  - Si las líneas se disparan en momentos distintos, cada disparo descuenta `redondeo(total disparado) − redondeo(total disparado antes)`.

#### S8. El inicio de restaurante no acepta órdenes de Planta (aviso de L25)
Como jefe de Planta en una tienda que usa los dos módulos, quiero que una orden de Planta en borrador no se pueda iniciar desde la Producción de restaurante, para que no se salte el paso "Liberar".

- **Pasos:** con una orden de manufactura en `draft`, intentar "Iniciar" desde la lista de restaurante o con `POST store/production-orders/:id/start`.
- **Criterios:**
  - El sistema rechaza el inicio. Mensaje propuesto: "Esta orden es de Planta: libérala desde su detalle de Planta."
  - Las órdenes de restaurante se inician igual que hoy.
- **Notas:** es consecuencia de la regla ya aprobada en `flujo-produccion.md:276`: una `draft` de manufactura sigue En espera y se libera desde su detalle.

#### S9. Cancelar una orden de producción es atómico (preexistente)
Como jefe de producción, quiero que dos cancelaciones simultáneas, o una cancelación junto con una finalización, dejen un único resultado, para que la reserva no se libere dos veces.

- **Criterios:**
  - Con dos peticiones concurrentes, solo una cambia el estado.
  - La otra recibe un error de estado y no mueve stock.
- **Notas:**
  - `cancel()` en `production-orders.service.ts:1344-1363` hace `findOne` y luego un `update` sin condición.
  - El arreglo: un claim condicional con `updateMany where status in (…)`, como en `start()`.
- **Riesgo:** ítem 4 (concurrencia).

#### S10. El disparo a cocina del cobro y de las mesas no se corta por tiempo (R3-001)
Como cajero, quiero cobrar una venta grande con adiciones sin que falle por tiempo, para no tener que reintentar.

- **Criterios:**
  - La transacción del disparo ordinario usa `{ timeout: 20_000, maxWait: 5_000 }` en cobro POS, cierre de mesa y división.
  - Es la convención de `payments.service.ts:2774` y `order-item-changes.service.ts:536`.
  - Una venta de 20 líneas con adiciones se cobra sin `Transaction already closed`.

#### S11. Mandar a cocina un pedido programado es todo o nada (L5a)
Como encargado de pedidos programados, quiero que si falla el paso a "En producción" no quede un ticket de cocina ni la receta descontada, para reintentar sin duplicar.

- **Criterios:**
  - Si `start()` falla en la prueba, no queda ticket de KDS ni consumo, y el pedido conserva su estado.
  - Al reintentar se crea un solo ticket.
- **Notas:** `sendToKitchen` dispara a cocina y luego transiciona fuera de una misma transacción.
- **Riesgo:** ítem 1.

### Bloque 2: rendimiento y contratos para todos los comercios (PR 2)

#### S12. Una sola lectura de industria por venta, y el checkout resuelve los destinos una vez (B2)
Como dueño de cualquier comercio, quiero que cobrar no repita consultas, para que el POS y el checkout no se vuelvan más lentos.

- **Criterios:**
  - En una venta, la industria de la tienda se lee como máximo una vez.
  - El checkout ecommerce llama a `resolveLineDestinations` una sola vez.
  - Un spec cuenta las consultas.

#### S13. La subconsulta de receta de productos corre solo donde se usa (B9)
Como dueño de un comercio retail, quiero que el listado de productos no consulte recetas que no uso, para que cargue igual de rápido que antes.

- **Criterios:**
  - La subconsulta de receta se incluye solo en las lecturas que muestran el destino o la receta.
  - El listado retail no la ejecuta.

#### S14. Los recordatorios de pedidos programados solo corren en restaurantes (B6)
Como dueño de un comercio no restaurante, quiero que el job de recordatorios no procese mi tienda, para no recibir avisos de una función que no tengo.

- **Criterios:** `scheduled-order-reminders.job.ts:66-92` filtra con la misma regla de industria de `module-industries.ts:81`.

#### S15. El ticket de KDS devuelve las opciones crudas de la línea (B4)
Como integrador del KDS, quiero que el ticket traiga `order_item_options` como antes, para que nada que lo lea se rompa.

- **Criterios:** la respuesta del ticket incluye `order_item_options` además de la vista nueva de adiciones.

#### S16. `no_show` se acepta como alias de `expired` (B5)
Como cliente de la API con un filtro guardado, quiero que `status=no_show` siga funcionando, para no recibir un 400.

- **Criterios:** `scheduled-orders.dto.ts:46` acepta `no_show` y lo traduce a `expired`.

#### S17. El deploy verifica el índice único parcial de producción (B11)
Como responsable del deploy, quiero que el deploy falle si falta el índice `production_orders_order_id_product_id_product_variant_id_key`, para detectar una migración saltada antes de los 500.

- **Criterios:**
  - `assert-schema-columns.js` comprueba que el índice existe y es parcial.
  - Con el índice ausente, sale con error.

#### S18. La industria se lee de una sola fuente en frontend y backend (decisión de Rafael)
Como dueño de un restaurante, quiero que el panel muestre los módulos que el servidor me permite usar, para que no vea botones que luego fallan.

- **Pasos:**
  1. Una consulta de solo lectura en prod, ya autorizada, cuenta las tiendas cuyo `stores.industries` difiere de `store_settings.settings.general.industries`.
  2. Con conteo > 0: el frontend (`auth.facade.ts:266`, que se usa en 22 sitios) pasa a leer la fuente que aplica el backend.
  3. Con conteo = 0: un spec fija que las dos fuentes se escriben juntas.
- **Criterios:** el conteo y la rama elegida quedan en el Log.

#### S19. Iniciar o finalizar una venta entera responde error si no se movió ninguna orden (aviso e)
Como operario, quiero que "Iniciar" o "Finalizar" la tarjeta de una venta no responda éxito si todas sus órdenes fallaron, para no creer que avanzó.

- **Criterios:**
  - `POST sale/:orderId/start|complete` con `moved = 0` y `failed > 0` responde error con los motivos.
  - Con algún `moved`, responde como hoy.

#### S20. La lista del día no recorta en silencio (aviso c)
Como operario de producción, quiero ver todas las órdenes del día, o un aviso de que faltan, para no perder órdenes.

- **Decisión de Rafael:** "Paginar sin límite".
- **Criterios:**
  - La lista del día carga por páginas al hacer scroll y llega a todas las órdenes del día, sin tope fijo.
  - Con más órdenes que una página, al bajar aparecen las siguientes sin duplicar ni saltar ninguna (cursor estable por `due_date`, `id`).
  - La Producción activa y la agenda que reutilizan `findDay` siguen mostrando lo mismo.
- **Notas:** hoy `findDay` corta en 500 filas sin avisar.

### Bloque 3: frontend (PR 3)

#### S21. La agenda no reintenta sin fin cuando no hay permiso de Producción (M4, aviso g)
Como encargado de pedidos sin permiso de Producción, quiero que la agenda cargue normal, sin recargas cada 15 s, para trabajar sin parpadeos ni tráfico inútil.

- **Pasos:** con un usuario que tiene `store:scheduled_orders:read` pero no `store:production_orders:read` ni `store:manufacturing:orders:read`, abrir la agenda y el detalle de un pedido.
- **Criterios:**
  - Sin permiso, no se abre el stream de producción.
  - Un 403 lo detiene.
  - No hay `refresh` periódico.
  - Con permiso, cuando el stream cae a modo manual, vuelve a vivo al recuperar la red o el foco, no solo con `reconnect()`.

#### S22. El modal de producción del detalle de orden se carga bajo demanda (B7)
Como cajero de retail, quiero que el detalle de orden no descargue el código de Producción, para que abra igual de rápido.

- **Criterios:** `order-details-page.component.ts` carga `ProductionOrderDetailModalComponent` con `@defer` o con un import dinámico.

#### S23. En una tienda solo Planta, el detalle de la venta usa el endpoint de manufactura (B8)
Como jefe de Planta sin módulo de restaurante, quiero ver la venta ligada desde la orden de Planta sin errores de permiso.

- **Criterios:** `order-detail-page.component.ts:196-212` (`loadSaleDetail`) usa el endpoint de manufactura cuando la tienda no tiene Producción de restaurante.

#### S24. La ruta vieja vuelve a Insumos y la lista del día tiene su propia ruta con permiso (B10, aviso d)
Como usuario con un enlace guardado a `/scheduled-orders/production`, quiero llegar a Insumos como antes, y que la lista del día pida su permiso.

- **Criterios:**
  - `/scheduled-orders/production` muestra Insumos.
  - La lista del día vive en su propia ruta con `data.permission`.
  - Los menús apuntan a la ruta correcta.
- **Notas:** `scheduled-orders.routes.ts:10-24`.

#### S25. El cronómetro muestra lo mismo en cualquier equipo (aviso de L25)
Como operario, quiero que el cronómetro de una orden marque igual en mi equipo y en el del jefe, aunque un reloj esté desfasado.

- **Criterios:**
  - El cronómetro corrige el desfase entre el reloj del equipo y el del servidor, con la hora de la respuesta o un `server_now`.
  - Con el reloj del equipo adelantado 5 minutos, muestra el mismo tiempo que otro equipo en hora.
- **Notas:** cumple el criterio ya aprobado en `flujo-produccion.md:265`.

#### S26. Una recarga fallida no muestra la agenda vacía
Como encargado de pedidos, quiero que si falla la recarga de la agenda vea un error con "Reintentar", no "No hay pedidos", para no creer que se borraron.

#### S27. El detalle no mezcla órdenes al cambiar de una a otra (aviso h)
Como operario, quiero que al pasar de una orden a otra en el detalle se muestre solo la última, para no ver datos cruzados.

- **Criterios:** una carga anterior no pisa la actual; se usa `switchMap` o se cancela la petición previa.

### Pruebas que faltan (cada una va en el PR de su código)

#### S28. Pruebas que faltan
- El spec de QUI-989 fija el `where` exacto y cubre el camino de cierre de mesa (L5b).
- Un spec cubre el menú que solo ve el restaurante.
- Los mocks de `order_items.count` dejan de ser genéricos.
- Una prueba directa del rollback y del orden de `afterCommit` en la rama `withinTx`, con `$transaction` real (R3-002).
- Se verifica `restart` sobre una venta cancelada con `produced_qty > 0`. También se verifica que una orden cancelada desde Planta no revive con la siguiente sincronización de la venta (aviso b, que #1132 debería cubrir con `restart`). Si algo falla, se reporta a Rafael antes de decidir.

### Sin cambio, con motivo
- El token del SSE va en query string (aviso f). Es el patrón del KDS en el repositorio, porque EventSource no envía cabeceras.

## Tasks

| ID | S# | Tarea | Ruta | Estado |
| --- | --- | --- | --- | --- |
| T1 | S18 | Consulta de solo lectura en prod y registro del conteo | inline | hecho (L8: 0 difieren → rama spec guarda en A2) |
| T2 | S4, S5 | `emitDeliveryCogs` legado y salida temprana de `ensureForOrder`, con tests | inline | pendiente |
| T3 | S2, S9 | Reserva incremental con tope y `cancel()` atómico, con tests | inline | pendiente |
| T4 | S1, S6 | Cancelación: aviso si falla la merma, y disposición por producto con Liberar por defecto (backend y modal), con tests | inline | pendiente |
| T5 | S3, S7, S10, S11 | Adición sin existencias nombrada, sumar y luego redondear, timeout del disparo y `sendToKitchen` atómico, con tests | inline | pendiente |
| T6 | S8 | El `start()` de restaurante rechaza órdenes de Planta, con test | inline | pendiente |
| T7 | S1-S11 | PR 1 a develop, verificador independiente (ítems 1 y 4) y gate ≥85 | inline + verificador Opus | pendiente |
| T8 | S12-S17, S19, S20 | Bloque 2 con tests | inline | pendiente |
| T9 | S12-S20 | PR 2 encadenado y gate ≥85 | inline | pendiente |
| T10 | S21-S27 | Bloque 3 frontend, specs en la lista de karma de CI y Playwright | escritor sonnet (frontend, superficie disjunta del backend) | pendiente |
| T11 | S21-S28 | PR 3 encadenado y gate ≥85 | inline | pendiente |
| T12 | S28 | Pruebas que faltan, en el PR de su código | inline | pendiente |

Estimación: unas 1.150 líneas de autor (PR 1 ~450, PR 2 ~300, PR 3 ~400).
Riesgo: S1, S2, S6 y S11 tocan reservas y consumo de stock (ítem 1). S9 toca concurrencia (ítem 4). Todo eso va en el PR 1, con verificador independiente al final de T7.
Orden: este plan va antes que `pedidos-programados-ux`. Los dos tocan `payments.service.ts` y la agenda, así que ese plan se rebasa sobre este.

## Log

- L1 (2026-11-10, objetivo de Rafael): "publica la release de todos los cambios consolidados en develop y publica despues de pasar la release code review con un puntaje superior al 85% y solo si no hay hallazgos, altos, criticos o bloqueantes. si hay solo bajos y medio listamelos todos y release, ojo no debe existir regresion con comercios existentes."
- L2 (2026-11-10, release review de #1134 en 1fc2dcfa7):
  - CI verde.
  - 6 revisores y la re-verificación del orquestador dieron 0 críticos y 0 altos.
  - Se descartaron los dos altos reportados (QUI-1001). El conteo en prod dio 0 tiendas no restaurante usando esas funciones, y la decisión fue "Ocultar siempre".
  - Quitar "Usar stock" en platos preparados no producibles es la matriz de QUI-999.
  - El stack sacó 84,7/100.
- L3 (2026-11-10, Rafael): "Publica la version tal como esta y de una vez vamos a crear el plan para solucionar todo lo que quede pendiente de ajustar, sin tomar desiciones arbitrarias, todo lo que no tengas claro como debe quedar me lo preguntas, solo decide cosas claras que no te generen duda o confusion."
  - #1134 se fusionó a main como 7ad35e6fb.
  - Deploy backend: run 42870220077 OK, con las 6 migraciones aplicadas y assert-schema OK.
  - Deploy frontend: run 42870220145 OK.
- L4 (2026-11-10, decisiones de Rafael):
  - Cancelar con merma si falla el ajuste: "Cancela y avisa (Recomendado)".
  - Bajos B4/B5/B10/B11: "Corregirlos todos".
  - Divergencia de industria: "Incluir con consulta (Recomendado)".
  - Redondeo: "Sumar y luego redondear (Recomendado)".
  - Disposición: "sugerir por producto pero siempre por defeto tener preseleccionado el reuso de cualquier insumo o producto, que en este caso no se cual es si merma o liberar creeria que liberar". Reuso = Liberar: lo producido vuelve a vendible.
- L5 (2026-11-10, decisiones del orquestador por ser claras):
  - S8 aplica la regla ya aprobada de `flujo-produccion.md:276`.
  - S25 cumple el criterio aprobado de `:265`.
  - S10 sigue la convención de timeout del repositorio.
  - El aviso (f) queda sin cambio porque es el patrón del KDS.
  - Los textos de S1 y S8 son propuestas que Rafael puede cambiar.
- L6 (2026-11-10, Rafael): lista del día: "Paginar sin límite" (S20). Linear regla 10 para QUI-988..QUI-1002: "Sí, moverlos (Recomendado)".
- L7 (2026-11-10, Rafael, aprobación): "Ejecuta todo todo todo! todo es todo y PR de cada cosa con su review y merge posteriormente release de todo".
  - Rutas: cada PR es una rama propia desde `origin/develop`.
    - PR A1 `fix/release-1134-hallazgos` (worktree `Vendix-release-fixes`): S1-S11, incluido el modal de cancelación de S1/S6, y las pruebas de S28 que tocan esos archivos.
    - PR A3 `fix/release-1134-frontend` (worktree `Vendix-release-fe`): S21-S27.
    - PR A2 `fix/release-1134-rendimiento`: S12-S20, incluido el frontend de la paginación de S20. Arranca cuando A1 termine sus specs y A3 esté fusionado, para no correr dos jest a la vez ni chocar en la lista del día.
  - Disparador de escritor: (a) paralelismo, con backend A1 y frontend A3 en superficies disjuntas, y (b) respaldo de contexto del padre. Son escritores sonnet. El padre audita y es dueño de git.
  - Verificador Opus independiente para A1 (ítems 1 y 4).
  - Gate `pr-code-review` ≥85 por PR, merge a develop y release final a main.
- L8 (2026-11-10, T1/S18, consulta de solo lectura autorizada en prod, `BEGIN READ ONLY … ROLLBACK`): 111 tiendas; 0 con `stores.industries` distinto de `store_settings.settings.general.industries`; 0 distintas en `restaurant`; 3 tiendas sin `general.industries` en settings (la comparación las excluye). Rama elegida: conteo = 0, así que en A2 un spec fija que las dos fuentes se escriben juntas. El escritor de A2 revisa qué hace `auth.facade.ts:266` con esas 3 tiendas cuando el arreglo de settings es nulo, y lo reporta sin cambiar comportamiento.
- L9 (2026-11-10): se lanzan los escritores sonnet A1 (S1-S11, S22 y parte de S28) y A3 (S21, S23, S24, S26, S27). S22 pasa a A1 porque comparte `order-details-page.component.ts` con el modal de cancelación. S25 (cronómetro con desfase del servidor) pasa a A2.
- L10 (2026-11-10, auditoría del padre sobre A1):
  - A3 se fusionó como #1135 (0d5b765c5) con gate 92/100.
  - A1: 22 archivos y un spec nuevo, dentro de su superficie. Specs re-ejecutados: production-orders 68/68 y kitchen-fire 121/121.
  - S7: el escritor acumulaba por insumo entre platos distintos. Producción redondea por orden, una por plato y variante, así que el padre cambió la clave a plato+variante+insumo, con dos tests:
    - dos líneas de 0,5 del mismo plato descuentan 1;
    - dos platos distintos que comparten insumo descuentan 2, como producción.
  - S7, redondeo entre disparos separados (nota técnica): queda pendiente. Cocina no persiste las exclusiones por línea ni la fracción ya disparada, así que hacerlo exacto exige una migración. El criterio observable, dos líneas de 0,5 en un disparo, sí se cumple. Se reporta como decisión de Rafael al cierre.
  - S3: `assertIngredientsAvailable` suma el stock vendible de todas las ubicaciones. No es más estricta que el `updateStock` por ubicación, y es la misma guarda que cocina ya aplica a las adiciones.
  - Correcciones menores del padre:
    - el aviso de S1 dura 10 s en lugar de 1,75 s;
    - el comentario del DTO volvió a su interfaz.
  - Se borraron los temporales del escritor.
