# Pedidos programados: entrega con los métodos de la tienda y configuración rediseñada

Objetivo: que un pedido programado use los métodos de envío que la tienda ya tiene, que no se pierda al cerrar el modal y que su selector y su configuración se vean y se usen mejor, con el diseño de Vendix.
Rama: `feat/pedidos-programados-ux` en el worktree `Vendix-pedidos-prog`, desde 1fc2dcfa7 (= `origin/develop`). Se rebasa sobre `fix/release-1134-hallazgos` cuando ese plan se fusione. Entrega: PR a develop con gate `pr-code-review` ≥85, y luego release.
Runner: backend `npx jest -c jest.isolated.config.js --rootDir src <spec>`, un spec por vez. Cada spec de frontend nuevo entra en la lista `--include` de karma en `ci.yml`. La UI se verifica con Playwright contra el vhost. Skills: `vendix-ui-ux`, `vendix-zoneless-signals`, `vendix-frontend-modal`, `vendix-settings-system` y `vendix-ecommerce-checkout`.

## Specs

### S1 — El pedido programado en el POS exige cliente
Anotación 1: "Un pedido programado debe ser obligatoriamente con cliente"
Decisión: "Solo obligatorio en POS en tienda en linea queda segun la config de la tienda en linea para los checkouts"

Como cajero en el POS, quiero que al activar "Pedido programado" el sistema me pida el cliente, para saber a quién entregar y a quién recordar.

- **Pasos:**
  1. En el POS, agrega productos.
  2. Activa "Pedido programado".
  3. Intenta seguir sin cliente.
- **Criterios:**
  - Sin cliente, el POS no deja avanzar y lo pide junto al selector. Queda en "Con Cliente".
  - El backend rechaza un cobro POS con `schedule` y sin `customer_id`.
  - En la tienda en línea no cambia nada: el checkout sigue su configuración (`checkout.service.ts:1752-1763`).

### S2 — La entrega usa los métodos de envío de la tienda, con el flujo completo de domicilio
Anotación 3: "Los metodos de entrega deben ser los mismo que disponga el comercio para los envios: es decir el flujo de ordenes programados no debe gestionar sus propios metodos de envio, no nunca, debe reusar los metodos de envio que ya la tienda tiene disponible para su uso para envio a domicilio."
Anotación 6: "Tales como los activados aqui que se usan en el flujo a domicilio"
Decisiones:
- "Igual que domicilio (Recomendado)"
- "Solo si está configurado" (recoger en tienda)
- "Ese pedido como todas las ordens se despacha manualmente, segun la gestion de la orden que tiene la accion de despachar y se elije que modo de despacho se usara..."

Como cajero, quiero elegir para un pedido programado uno de los métodos de envío activos de la tienda (por ejemplo "Entrega Rápida Local"), con su dirección y su costo, para cobrar y entregar igual que un domicilio.

- **Pasos:**
  1. En Configuración → Envíos, ten activo "Entrega Rápida Local".
  2. En el POS, haz un pedido programado con cliente.
  3. Elige el método, la dirección y la franja.
  4. Cobra.
  5. Abre la orden y usa "Despachar".
- **Criterios:**
  - El selector solo ofrece los métodos de envío activos de la tienda, los mismos del flujo a domicilio. No hay una lista propia.
  - "Recoger en tienda" aparece solo si la tienda tiene un método de tipo recogida activo.
  - Un método de domicilio pide la dirección y suma el costo de envío del método, igual que `pos-shipping-step`.
  - Si la tienda no tiene métodos, se ve el aviso que ya muestra la selección de métodos de envío.
  - La orden queda con `delivery_type` de domicilio y su método de envío.
  - El despacho es manual, como en cualquier orden: desde "Despachar" en la gestión de la orden, donde se elige el modo.
  - Al cobrar no se crea remisión ni se agrega a ninguna ruta.
  - El `fulfillment_type` del agendamiento (`order_fulfillment_schedules`) se deriva del método elegido: recogida → `pickup`, domicilio → `delivery`.
- **Notas:**
  - `payments.service.ts:1039-1047` ya conserva `home_delivery` y solo convierte `direct_delivery`/`dine_in` en `pickup`. Hay que verificar que el resto del cobro programado no lo pise.
  - Hay que verificar que `fulfillment-availability.service.ts` deje de validar contra `fulfillment_types` de la configuración.
  - Hay que unificar el endpoint que lee el POS: hoy conviven `GET /shipping/methods` y `GET store/shipping-methods`.
  - En la tienda en línea, el agendamiento usa el método que ya eligió el checkout.
- **Riesgo:** toca el costo de envío y el flujo de entrega de la orden (dinero). Se marca para RDD.

### S3 — Quitar "Tipos de entrega" de la configuración
Anotación 5: "Esto no debe existir, se debe reusar los metodos de entrega disponibles de la tienda"
Decisión: "Ninguna tienda lo tiene esto es nuevo, no hagas nada ya el flujo de seleccion de metodos de envio avisa si no hay ninguno configurado"

Como dueño, quiero que la configuración de pedidos programados no tenga su propia lista de tipos de entrega, para administrar los envíos en un solo lugar.

- **Criterios:**
  - La sección "TIPOS DE ENTREGA" desaparece del formulario.
  - Nadie lee `fulfillment_types`.
  - El campo sale de los valores por defecto (`default-store-settings.ts:556`).
  - El DTO (`settings-schemas.dto.ts:2413-2419`) lo sigue aceptando como opcional e ignorado. Así un cliente con caché no recibe 400 durante el deploy (`forbidNonWhitelisted`).
  - No hay migración de datos.

### S4 — Cerrar el modal no borra el pedido programado en curso
Anotación 4: "Si se me cierra el modal no debe desaparecer el flujo de pedido programado que estaba realizando"

Como cajero, quiero que al cerrar el modal de cobro sin terminar se conserve lo que llevaba del pedido programado (fecha, franja, método y dirección), para retomarlo sin empezar de cero.

- **Pasos:**
  1. Arma un pedido programado hasta la franja.
  2. Cierra el modal.
  3. Vuelve a abrir el cobro.
- **Criterios:**
  - Al reabrir están la fecha, la franja, el método y la dirección.
  - El estado se limpia solo al cobrar, al vaciar el carrito o con "Quitar programación".
- **Notas:** hoy lo resetean el efecto de `pos-checkout-shell.component.ts:916-918` y `pos-payment.service.ts:736` y `:932`.

### S5 — Un selector de fecha más claro, con la misma estrategia de uso
Anotación 2: "Me gusta el selector de fecha pero mejoremoslo para que se vea mas lindo e intuitivo manteniendo la estrategia de usabilidad"

Como cajero, quiero un selector de fecha y franja más claro y agradable que conserve cómo se usa hoy, para programar rápido sin errores.

- **Criterios:**
  - Se conserva la estrategia actual: primero el día, luego la franja.
  - Los días no disponibles y las franjas llenas se ven deshabilitados, con su motivo.
  - Se ve el resumen "Entrega: {día} · {franja} · {método}".
  - Sigue el lenguaje Soft UI con un solo acento (`vendix-ui-ux`) y funciona en móvil.
- **Notas:** `pos-scheduled-order-picker.component.ts` y `pos-scheduled-order.service.ts`. Antes de codificar, el orquestador muestra una propuesta visual (captura o mock) para que Rafael la apruebe.

### S6 — Los horarios se configuran en tarjetas plegables
Anotación 7: "Mejorar la configuracion de horarios permitiendo que se vea mucho mejor y mas usables y colapsables"
Anotación 8: "Como estos" (`app-expandable-card` de "Horario por día")

Como dueño, quiero configurar los horarios de los pedidos programados en tarjetas plegables como "Horario por día", para ver y editar cada día sin una página larga.

- **Criterios:**
  - Cada día es un `app-expandable-card` (`shared/components/expandable-card`).
  - La tarjeta plegada muestra un resumen, por ejemplo "8:00–18:00 · 4 franjas" o "Cerrado".
  - Dentro se editan las franjas y la capacidad.

### S7 — Los recordatorios se configuran con el diseño de Notificaciones
Anotación 9: "Mejorar mucho mas el esquema de configuracion de recordatorios, tales como lo de notificaciones mas lindo y optimizados segun el esqueda de desing de vendix"

Como dueño, quiero configurar los recordatorios con el mismo diseño de Configuración → Notificaciones, para entenderlos de un vistazo.

- **Criterios:** los recordatorios usan el patrón de `notifications-settings-form.component.ts`: filas con interruptor, canal y anticipación, agrupadas en tarjetas.

### S8 — La configuración de pedidos programados queda consolidada
Anotación 10: "Y en general mejorar y consolidar el desing de la config de pedidos programados."

Como dueño, quiero una sola pantalla ordenada para la configuración de pedidos programados, para encontrar cada ajuste sin buscar.

- **Criterios:**
  - Las secciones van en este orden: General (activar, anticipación mínima y máxima), Horarios (S6), Recordatorios (S7) y un enlace "Métodos de envío" a Configuración → Envíos (reemplaza S3).
  - Todas usan tokens del tema, sin colores propios.

## Tasks

| ID | S# | Tarea | Ruta | Estado |
| --- | --- | --- | --- | --- |
| T1 | S2, S3 | Backend: `fulfillment_type` derivado del método, sin validar `fulfillment_types`, defaults y DTO compatibles, tests | inline | hecho, commit 03a8176c5; scheduled-orders 39/39 |
| T2 | S1 | Backend: cobro POS programado exige `customer_id`, test | inline | hecho, commit 03a8176c5; payments.service.scheduled-fire 13/13 |
| T3 | S1, S2, S4 | POS: exige cliente, métodos de envío de la tienda reutilizando `pos-shipping-step`, estado persistente al cerrar | escritor sonnet | hecho en código, commit 7390b9510 (rebasado); karma en CI, Playwright pendiente |
| T4 | S5 | Selector rediseñado (L7: sin aprobación previa; capturas en el PR) | escritor sonnet | hecho en código, commit 7390b9510 (rebasado); capturas pendientes |
| T5 | S3, S6, S7, S8 | Configuración rediseñada (plegables, recordatorios, consolidación, sin "Tipos de entrega") | escritor sonnet (superficie disjunta de T3) | hecho en código, commit e2438c509 (rama feat/pedidos-programados-config); karma y Playwright pendientes |
| T6 | S1-S8 | Playwright en el vhost (POS y configuración), PR a develop, gate ≥85 y RDD por S2 | inline | PRs hechos (#1140, 54e249d2d, gate 91/100; #1138, 871394da4, gate 92/100; RDD aprobada en ambos); Playwright y capturas de S5 en el demo de prod tras el deploy (L12) |

- **Estimación:** unas 900 líneas de autor.
- **Riesgo:** S2 toca el costo de envío y la entrega de la orden (dinero). S3 cambia un formato persistido de configuración, aunque no lo usa ninguna tienda. S2 lleva un verificador independiente al final de T6.
- **Escritores en paralelo:** T3 y T5 tienen superficies disjuntas (POS y configuración), así que corren a la vez. El padre es dueño de git y del backend.

## Log

- L1 (2026-11-10, pedido de Rafael, 10 anotaciones sobre capturas): las 10 anotaciones citadas en S1-S8, más "ajusta esto tambien a nivel de usabilidad y UI".
- L2 (2026-11-10, Rafael): "pero una pregunta... lo que te dije de las mejoras de UI y usabilidad no se realizo?". Se respondió que no se había hecho, solo explorado, y que entra en este plan.
- L3 (2026-11-10, decisiones de Rafael):
  - Entrega programada: "Igual que domicilio (Recomendado)".
  - Recoger en tienda: "Solo si está configurado".
  - Cliente: "Solo obligatorio en POS en tienda en linea queda segun la config de la tienda en linea para los checkouts".
  - Transición: "Ninguna tienda lo tiene esto es nuevo, no hagas nada ya el flujo de seleccion de metodos de envio avisa si no hay ninguno configurado".
  - Despacho: "Ese pedido como todas las ordens se despacha manualmente, segun la gestion de la orden que tiene la accion de despachar y se elije que modo de despacho se usara...".
- L4 (2026-11-10, orquestador):
  - Se mantiene la aceptación de `fulfillment_types` en el DTO para no romper los clientes con caché durante el deploy.
  - El selector necesita una propuesta visual aprobada antes de codificar, porque "más lindo" es criterio de Rafael.
- L5 (2026-11-10, Rafael, aprobación): "Ejecuta todo todo todo! todo es todo y PR de cada cosa con su review y merge posteriormente release de todo".
  - Entrega en dos PR, cada uno con su rama desde `origin/develop`.
    - PR B1 `feat/pedidos-programados-ux` (worktree `Vendix-pedidos-prog`): S1, S2, S4 y S5, con el backend de T1 y T2.
    - PR B2 `feat/pedidos-programados-config` (worktree `Vendix-pedidos-config`): S3, S6, S7 y S8, con el default y el DTO de S3.
  - Con "todo es todo", la propuesta visual del selector (S5) ya no espera una aprobación previa. Se implementa con `vendix-ui-ux` y las capturas van en el PR para que Rafael las revise ahí.
  - Escritores sonnet de frontend en paralelo con los de backend del plan A. El backend de B1 corre después del backend del plan A, para no correr dos jest a la vez.
- L6 (2026-11-10, T5): escritor B2 terminado, auditado por el padre y en commit e2438c509.
  - Payload: las 9 claves del DTO menos `fulfillment_types`. El formulario descarta la clave heredada.
  - Spec nuevo agregado al `--include` de karma.
  - Cupo por día: el esquema solo trae `slot_capacity` y `day_capacity` globales, así que la capacidad quedó en la cabecera de Horarios y cada tarjeta edita Desde y Hasta. No se cambia el backend porque no se pidió.
  - Pendiente para B1 (T1) o el padre: `ScheduledOrdersSettings.fulfillment_types` pasa a opcional en `core/models/store-settings.interface.ts`.
  - B2 se rebasa sobre develop después de B1, porque el DTO debe aceptar la ausencia de la clave.
- L7 (2026-11-10, T3 y T4): escritor B1-FE terminado y auditado, commit b244c0efd. Detalle:
  - El POS fuerza el carril `enviar` con pedido programado y reutiliza `PosShippingService.getShippingMethods()` (`pos-shipping.service.ts:30`). El paso Envío ofrece recogida solo si hay un método `pickup` activo.
  - El payload `schedule` queda en `{start, end}`.
  - Se quitó el efecto `!isOpen → reset`. El reset ocurre al vaciar el carrito y en los `tap` de éxito de `pos-payment.service.ts`.
  - El cliente es obligatorio: sin venta anónima ni alias.
  - El padre comprobó que `@if (effectiveIntent() === 'delivery')` no cambia el flujo normal, porque `envio` solo está en `stepKeys` con `enviar`.
- L8 (2026-11-10, T1 y T2, el padre inline):
  - `fulfillmentTypeForDelivery(delivery_type, fallback)`: `pickup` da pickup; `home_delivery` u `other` dan delivery; sin `delivery_type`, el valor del cliente o pickup. `createForOrder` recibe el `delivery_type` de la orden en POS y ecommerce. `preValidate` y `createForOrder` dejan de validar `fulfillment_types`.
  - Nuevo error `SCHED_CUSTOMER_REQUIRED` (400) en el cobro POS programado sin `customer_id`. Va después de `SCHED_DISABLED`.
  - Se quita `fulfillment_types` del default y la interfaz del backend queda opcional. El DTO lo sigue aceptando como opcional y marcado `deprecated`.
  - La interfaz del frontend `core/models` queda para B2, porque el formulario viejo de B1 aún lo lee como obligatorio.
- L9 (2026-11-10): B2 suma el commit b2e034a23, que deja `fulfillment_types` opcional y obsoleto en `core/models/store-settings.interface.ts`. B2 se rebasa sobre develop después de fusionar B1. Revisión del padre sobre el backend de B1: `apps/mobile` no usa pedidos programados, así que el cliente obligatorio del POS no rompe su contrato.
- L10 (2026-11-10): backend de T1 y T2 commiteado (995555aaa, rebasado sobre 0d5b765c5 como 03a8176c5); scheduled-orders 39/39 y payments.service.scheduled-fire 13/13. Comprobado que el formulario de configuración de esta rama mezcla `DEFAULT_SETTINGS` con lo guardado, así que quitar `fulfillment_types` del default del backend no rompe `.includes` antes de que llegue B2. Siguiente: verificador independiente por S2 (dinero), PR, gate y RDD.
- L11 (2026-11-10): un verificador Opus independiente revisó S1-S8 y no encontró bloqueantes. S1, S2, S3 (backend) y S4 pasan. Su advertencia 1 se corrigió en el commit 3d1d1f416: abrir otra venta o cambiar de mesa ahora descarta la programación anterior. El servicio es de raíz y antes la heredaba. Hay 2 tests nuevos en el describe S4. Quedan como advertencias para el PR: `SCHED_FULFILLMENT_TYPE` queda sin uso, ningún spec de checkout cubre `dto.schedule`, al apagar la programación el modal sigue en "Con Cliente", y un POS en caché que mande un programado anónimo recibe 400. Rebasado sobre develop (a3a0850ce); scheduled-orders 39/39 y payments.service.scheduled-fire 14/14. En el commit a703fc2ac de B2 (rama config), un recordatorio ya no puede repetir la anticipación de otro.
- L12 (2026-11-10): B1 se fusionó como #1140 (gate 91/100) y B2 como #1138 (gate 92/100), los dos con RDD aprobada y autoridad consumida. Playwright en local no sirve: `vendix_backend` monta el checkout principal, que está en otra rama y no tiene estos cambios. La verificación visual (POS programado, selector de S5, configuración) pasa al demo de prod después del deploy del release, con la cuenta demo.
