# Promociones: auditoría completa, fixes y días de la semana

Rama `fix/promociones-dias-semana` (base `develop` @ `b80dcfcae`). Rutas de backend relativas a `apps/backend/src/` y de frontend a `apps/frontend/src/app/`, salvo que se indique otra cosa. Las líneas corresponden al HEAD de la rama: `(antes)` indica que la evidencia de la falla está en `b80dcfcae`.

## Specs

### Historias de usuario

**H1. Promo por días (feature).** Como dueño de un restaurante en el admin de Vendix, quiero que una promoción aplique solo los martes, miércoles y viernes, para atraer clientes en los días flojos sin regalar margen los días llenos.

1. Ir a Marketing → Promociones → Nueva promoción.
2. En "Días en que aplica", marcar M (martes), M (miércoles) y V (viernes), o usar los atajos Todos / Entre semana / Fin de semana.
3. Guardar y activar.

Criterios de aceptación:

- El listado y la tarjeta muestran "Mar · Mié · Vie".
- Un martes, la promo se aplica sola en el POS y en el carrito de la tienda online, y aparece en la vitrina.
- Un jueves no se aplica, no aparece en la vitrina ni en la tarjeta del producto, y no la ofrece el POS.
- Si alguien valida su código un jueves, ve: "Esta promoción no aplica hoy: solo es válida los martes, miércoles y viernes".
- El día se cuenta con la hora de la tienda: un viernes a las 22:00 en Bogotá sigue siendo viernes, aunque en UTC ya sea sábado.
- Las promociones existentes, sin días elegidos, siguen aplicando todos los días.

**H2. Las promos se aplican bien.** Como cajero en el POS, o como cliente en la tienda online, quiero que el descuento que veo sea el que se cobra y que la promo respete sus fechas, para no tener reclamos en caja.

1. Crear una promo del 1 al 30 de noviembre.
2. Cobrar el 30 de noviembre a las 15:00: la promo aplica. Antes había dejado de aplicar el 29 a las 19:00.
3. Cobrar un borrador del POS que ya traía una promo con cupo 1: el descuento se mantiene. Antes desaparecía o fallaba.
4. Cancelar una venta con promo: el uso vuelve al cupo de la promo. Antes "primeras 50 ventas" se agotaba con ventas canceladas.

### Decisiones tomadas

Regla aplicada: ante lo ambiguo, la opción más simple, aditiva y que no cambia las promociones que hoy funcionan.

- **D1 — `active_weekdays Int[]` (0 = domingo … 6 = sábado), con `[]` = todos los días.** Es la convención de `Date#getDay` y `Intl`, la misma del helper de zona horaria y de los WEEKDAYS de tarifas hoteleras. Se descartó un enum array porque pide un tipo nuevo, una migración más pesada y obliga a mapear en cada consumidor. Los 7 días se guardan como `[]`: hay una sola forma de decir "siempre". Un CHECK en la base asegura el rango 0..6.
- **D2 — Fechas como fechas de calendario de la tienda.** No se migran datos. El motor compara contra el reloj local de la tienda, expresado en el mismo espacio "naive" que la columna:
  - inicio ≤ hora local actual;
  - fin ≥ medianoche local de hoy, es decir, el día de fin cuenta completo.
  - Una promo que hoy aplicaba sigue aplicando; solo se corrigen los bordes, que estaban corridos 5 horas.
- **D3 — Estado efectivo calculado, sin cron.** No existe un job que pase `scheduled → active → expired`. En vez de crearlo (sería un proceso nuevo con escrituras masivas), el listado expone `effective_state`, derivado de las fechas en la zona de la tienda. El motor ya trataba `active`/`scheduled` dentro de la ventana como vigente. La columna `state` no se toca.
- **D4 — `check-eligibility` delega en `quoteDiscounts`.** El descuento se calcula en un solo lugar: la vista previa da exactamente lo mismo que el cobro.
- **D5 — Cancelar devuelve el uso; el historial se conserva.** Las filas de `order_promotions` no se borran ni se ponen en 0, porque son auditoría y reportes. Solo se decrementa `usage_count`. El límite por cliente ignora las órdenes canceladas o reembolsadas.
- **D6 — Una promoción cancelada no se reactiva.** Se crea una nueva. Antes `activate` la revivía y ese estado se consideraba definitivo.
- **D7 — Escalas `per_product`: cada producto recibe el tramo que alcanzó.** Antes solo los productos del tramo de mayor valor recibían descuento. Es el comportamiento que el admin describe ("cada SKU se evalúa por su cuenta"). Un tramo de monto fijo se reparte una vez entre las líneas de ese mismo tramo.
- **D8 — Franja horaria: no incluida.** Agregar hora de inicio y fin suma dos columnas, la validación de cruce de medianoche y la UI. Queda como siguiente paso (P8). El reloj de la tienda (`PromotionClock.wall_now`) ya está listo para soportarla.
- **D9 — Códigos de promoción: no se unifican con cupones en este PR.** Está pendiente la decisión de Rafael (ver "Necesita decisión"). Se deja lista la validación por código en el backend (`POST /store/promotions/validate-code`), sin pantalla que la use.

### Archivos críticos y lo que se reutiliza

- Motor (único lugar del cálculo): `domains/store/promotions/promotion-engine/promotion-engine.service.ts`.
- Calendario: `domains/store/promotions/promotion-schedule.util.ts`. Reutiliza `resolveTimezoneCascade` y `localCivil` de `common/utils/store-timezone.util.ts`.
- Usos: `domains/store/promotions/promotion-usage.util.ts`.
- Migración: `prisma/migrations/20261216090000_promotions_active_weekdays/migration.sql`, más `prisma/assert-schema-columns.js`.
- Frontend:
  - `private/modules/store/marketing/promotions/utils/promotion-weekdays.util.ts`
  - formulario `promotion-form-modal`
  - listado `promotion-list`
  - POS `pos/cart/pos-cart.component.ts`

## Matriz de auditoría

Veredicto: **OK**, **FALLA (corregida)** o **FALLA (pendiente)**. Severidad: A = alta, M = media, B = baja. "Spec" es el test que demuestra la falla (falla contra el motor de `b80dcfcae` y pasa con el fix) o el comportamiento.

### 1. Cálculo del descuento

| # | Configuración | Esperado | Real (evidencia) | Veredicto | Sev. |
|---|---|---|---|---|---|
| 1.1 | `type` percentage / fixed_amount, flat | % sobre el total aplicable; fijo con tope en el total aplicable | `computeDiscountAmount` en `promotion-engine.service.ts:1948-1966` | OK | — |
| 1.2 | `max_discount_amount` | Tope del descuento por promo | `:1960-1963` (flat) y tope en la rama de escalas | OK | — |
| 1.3 | `min_purchase_amount` | Sobre el subtotal del carrito | Check en `quoteDiscounts` sobre `subtotal` | OK | — |
| 1.4 | `quantity_tiered` + `cart_total`, tiers por rango, `max_quantity` null, tier con su propio type/value | Tramo según las unidades del alcance | Rama de escalas de `quoteDiscounts`; specs "quantity_tiered - aggregated by scope" | OK | — |
| 1.5 | `quantity_tiered` + `per_product` con productos en tramos distintos | Cada producto recibe su tramo | (antes) `:772-790`: solo los productos del tramo de mayor valor. Ahora `:776` (`tierByLine`) | FALLA (corregida) | A |
| 1.6 | Escala de venta / presentaciones (`price_unit_quantity`) | Tramos en unidades de venta, dinero continuo | `toSaleUnits` / `toPriceUnits`; specs "escala de venta" | OK | — |
| 1.7 | `scope` product / category / order | Solo las líneas del alcance | `resolveApplicableItemIndexes` | OK | — |
| 1.8 | Categoría con subcategorías | — | El modelo `categories` no tiene jerarquía (`schema.prisma:1519`): no existen subcategorías | OK (N/A) | — |
| 1.9 | Producto en varias categorías | Coincide si alguna está en la promo | `getItemCategoryIds` usa `category_ids[]` | OK | — |
| 1.10 | Redondeo COP | 2 decimales, la suma de líneas igual al total | `roundMoney` (`:2025`) y la última línea absorbe el residuo | OK | — |
| 1.11 | Descuento > subtotal, líneas negativas | Nunca | `Math.min(accumulatedDiscount, lineTotal)` (`:1186`) | OK | — |

### 2. Elegibilidad, límites y fechas

| # | Configuración | Esperado | Real (evidencia) | Veredicto | Sev. |
|---|---|---|---|---|---|
| 2.1 | `start_date` / `end_date` (fecha de calendario) | Vigente del día de inicio al día de fin completos, hora de la tienda | (antes) `new Date()` UTC contra medianoche UTC: terminaba el día anterior a las 19:00 en Bogotá. Ahora `promotionDateWindowWhere` (`promotion-schedule.util.ts:85`). Spec "la fecha de fin incluye todo su día local" | FALLA (corregida) | A |
| 2.2 | Zona horaria de la tienda | `stores.timezone` → JSON legado → Bogotá | `loadStoreContext` (`promotion-engine.service.ts:98`). Spec "usa stores.timezone" | FALLA (corregida) | A |
| 2.3 | `usage_limit` / `usage_count` | No aplica con el cupo agotado | Check en `quoteDiscounts` | OK | — |
| 2.4 | `per_customer_limit` con órdenes canceladas | No cuentan | (antes) solo `discount_amount > 0`. Ahora `orders.state notIn [cancelled, refunded]` (`:276`, `:659`) | FALLA (corregida) | M |
| 2.5 | `is_auto_apply` vs manual | Las manuales solo si se piden | `quoteDiscounts` | OK | — |
| 2.6 | `priority` | Menor número gana; empate: id menor | Motor OK. `getActive` ordenaba `priority desc` y la vitrina `id desc`. Ahora alineados (`promotions.service.ts:218`, `ecommerce-promotions.service.ts`) | FALLA (corregida) | B |
| 2.7 | `state` draft / paused / cancelled / expired | No aplican | Filtro `state in [active, scheduled]` | OK | — |
| 2.8 | Transición `scheduled → active → expired` | Automática | No hay job: `expired` nunca se asigna. El motor lo compensa con la ventana de fechas. El listado ahora muestra `effective_state` (`promotions.service.ts:129`) (D3) | FALLA (corregida en lectura) | M |
| 2.9 | `activate` desde cancelada | Rechazar | (antes) la revivía. Ahora `PROMOTION_STATE_001` (`promotions.service.ts:474`). Spec `promotions.service.spec.ts` | FALLA (corregida) | B |
| 2.10 | Resumen "Activas" | Incluye las programadas ya iniciadas | (antes) solo `state='active'`. Ahora `promotions.service.ts:177` | FALLA (corregida) | B |

### 3. Apilamiento

| # | Configuración | Esperado | Real (evidencia) | Veredicto | Sev. |
|---|---|---|---|---|---|
| 3.1 | `winner_takes_all` (por defecto), varias automáticas | Gana una sola promo | Specs "winner-takes-all" | OK | — |
| 3.2 | `stacking_groups`: producto + orden | El descuento de orden va sobre el saldo; la suma de líneas igual al total | (antes) se repartía sobre el bruto y la parte de una línea ya en 0 se perdía: total ≠ suma de líneas. Ahora `:1084` (`residualLines`). Spec "el descuento de orden se reparte sobre el saldo" | FALLA (corregida) | A |
| 3.3 | Mismo producto en dos promos (stacking) | Gana la de mayor prioridad por línea | `lineWinnerMap` | OK | — |
| 3.4 | `max_combined_discount_percentage` | Tope global | `:1124` | OK | — |
| 3.5 | Automática + cupón | El cupón va sobre el subtotal ya descontado | `calculatePosCouponDiscount(..., promotionQuote.total_discount)` en `payments.service.ts` y `checkout.service.ts` | OK | — |

### 4. Superficies

| # | Superficie | Esperado | Real (evidencia) | Veredicto | Sev. |
|---|---|---|---|---|---|
| 4.1 | Vista previa `POST /store/promotions/check-eligibility` | Igual al cobro | (antes) aritmética propia: ignoraba escalas, estrategia y topes, e incluía manuales no pedidas. Ahora delega en `quoteDiscounts` (`promotion-engine.service.ts:134`). Spec "vista previa = cobro" | FALLA (corregida) | M |
| 4.2 | POS: cobro | El backend recotiza | `calculatePosPromotionQuote` (`payments.service.ts:3436`) ignora el monto del cliente | OK | — |
| 4.3 | POS: cobro de borrador adoptado | Su propia promo no consume el cupo | (antes) sin `exclude_order_id`, y el `create` duplicado chocaba con el unique (P2002 dentro de la tx). Ahora `exclude_order_id` (`:3446`, `:6684`) y `applyPromotion` idempotente (`promotion-engine.service.ts:173`). Spec "applyPromotion no duplica" | FALLA (corregida) | A |
| 4.4 | POS: listado `/active` | Solo lo que aplica hoy | (antes) sin día ni cupo y orden invertido. Ahora `promotions.service.ts:218` | FALLA (corregida) | A |
| 4.5 | POS: POS abierto al cruzar medianoche o fecha fin | Refresca | (antes) cargaba una sola vez. Ahora recarga cada 15 min (`pos/cart/pos-cart.component.ts:1863`) | FALLA (corregida) | M |
| 4.6 | POS: vista previa en el navegador | Igual al backend | `pos/services/pos-cart.service.ts:1698+` duplica el motor y no conoce `quantity_grouping` ni límites por cliente | FALLA (pendiente P5) | M |
| 4.7 | Mesas: cierre con productos ya pedidos | Cotiza toda la cuenta | Cotiza solo las líneas nuevas `dto.items` (`payments.service.ts:5556`); lo ya pedido (`:5484`) queda fuera | FALLA (pendiente P1) | A |
| 4.8 | Cuentas divididas | Reparten el descuento existente | `split-order.service.ts` / `utils/split-allocation.util.ts` reparten proporcionalmente; no recotizan | OK (heredan la falla 4.7) | — |
| 4.9 | Editor de órdenes | Recotiza sin contar la propia orden, con categorías y usos coherentes | (antes) sin `exclude_order_id`, `category_ids: null` (promos por categoría en 0) y borraba/reinsertaba sin ajustar usos. Ahora `orders.service.ts:4562`, `:4574`, `:5604` | FALLA (corregida) | M |
| 4.10 | Ecommerce: carrito y checkout | `quoteDiscounts` con categorías de la base | `cart.service.ts`, `checkout.service.ts:1349-1367` | OK | — |
| 4.11 | Ecommerce: vitrina | Lo mismo que aplica el carrito hoy | (antes) ocultaba las `scheduled` ya iniciadas y mostraba las agotadas. Ahora `ecommerce-promotions.service.ts:121`, `:142`. Spec `ecommerce-promotions.service.spec.ts` | FALLA (corregida) | M |
| 4.12 | Ecommerce / POS: tarjeta de producto | No anuncia promos agotadas ni fuera de su día | `findActiveAutoPromotionsForProducts` (`promotion-engine.service.ts:1609`). Specs "tarjeta de producto…" | FALLA (corregida) | M |
| 4.13 | Ecommerce: uso persistido | En la misma transacción de la orden | `persistPromotionsAndCoupon` (`checkout.service.ts:1533`) va fuera de la tx y después del commit | FALLA (pendiente P3) | M |
| 4.14 | Envío | No afecta el descuento | El descuento va sobre el subtotal de productos | OK | — |
| 4.15 | IVA | Descuento sobre bruto; se re-liquida el impuesto | Regla del owner 2026-09-28 en `payments.service.ts`. El POS móvil manda neto (comentario cerca de `:4022`) | OK (riesgo móvil, P6) | — |
| 4.16 | Variantes y modificadores | Precio de la línea | El motor usa el `unit_price` de la línea; las variantes van por `product_id` | OK | — |

### 5. Conteo de usos

| # | Caso | Esperado | Real (evidencia) | Veredicto | Sev. |
|---|---|---|---|---|---|
| 5.1 | Cancelar orden | Devuelve el uso | (antes) nunca se decrementaba. Ahora `releaseOrderPromotionUsage` (`orders/order-flow/order-flow.service.ts:8092`) en la tx del claim. Spec `promotion-usage.util.spec.ts` | FALLA (corregida) | A |
| 5.2 | Reembolso / devolución | Devuelve el uso | `refunds/**` y `return-orders/**` no lo tocan | FALLA (pendiente P4) | M |
| 5.3 | Concurrencia en el último cupo | No se pasa de `usage_limit` | Check en memoria e increment sin guard | FALLA (pendiente P2) | M |
| 5.4 | Registro duplicado por orden | Una fila por (orden, promo) | (antes) P2002 dentro de la tx del cobro. Ahora idempotente (4.3) | FALLA (corregida) | A |

### 6. Códigos y validación

| # | Caso | Esperado | Real (evidencia) | Veredicto | Sev. |
|---|---|---|---|---|---|
| 6.1 | `promotions.code` usable en POS / checkout | Aplica la promo | No existe ningún flujo: el campo "Código (cupón)" del form no lo usa nadie; el POS y el checkout validan contra `coupons` | FALLA (decisión de Rafael, D9) | M |
| 6.2 | `validatePromotion` | Errores tipados | (antes) `BadRequestException` plano y código muerto. Ahora `PROMOTION_*` (`common/errors/error-codes.ts`), `validatePromotionByCode` y `POST /store/promotions/validate-code` | FALLA (corregida) | B |
| 6.3 | Código fuera de día | Mensaje claro | `PROMOTION_NOT_TODAY_001`: "Esta promoción no aplica hoy: solo es válida los martes, miércoles y viernes" (`promotion-engine.service.ts:252`) | Nuevo | — |

### 7. Admin (frontend)

| # | Caso | Esperado | Real (evidencia) | Veredicto | Sev. |
|---|---|---|---|---|---|
| 7.1 | Editar: quitar fecha fin, código o límites | Se limpian | (antes) el form omitía los vacíos y el servidor conservaba el valor. Ahora se envían como `null` (`promotion-form-modal.component.ts:1225`) | FALLA (corregida) | M |
| 7.2 | Listado: fechas | Fecha de calendario | (antes) `toLocaleDateString()` mostraba un día menos. Ahora `formatDateOnlyUTC` (`promotion-list.component.ts:64`) | FALLA (corregida) | M |
| 7.3 | Listado: estado | Estado real | Ahora `display_state` (`:254`) | FALLA (corregida) | B |

## Feature: días de la semana

- **Base de datos:** migración aditiva `20261216090000_promotions_active_weekdays`:
  - `active_weekdays INTEGER[] DEFAULT '{}'` más un CHECK de rango 0..6.
  - Idempotente (`IF NOT EXISTS` y CHECK guardado por `pg_constraint`); probada dos veces seguidas dentro de una transacción con rollback sobre la DB local (10 filas existentes quedan en `{}`; el CHECK rechaza el 7).
  - Agregada a `assert-schema-columns.js`.
- **Backend:**
  - DTO create/update con validación (`IsArray`, `ArrayMaxSize(7)`, `ArrayUnique`, `IsInt`, `Min(0)`, `Max(6)`) y normalización (los 7 días o `null` → `[]`).
  - Se respeta en: auto-aplicación y manuales (`quoteDiscounts`), vista previa, validación de código (error claro), `/store/promotions/active` (POS), vitrina de ecommerce, tarjetas de producto (catálogo y admin), cobro POS y checkout ecommerce (los dos usan `quoteDiscounts`).
  - El día se calcula en la zona horaria de la tienda (`buildPromotionClock`).
- **Frontend:**
  - Chips L M M J V S D con atajos Todos / Entre semana / Fin de semana, `aria-pressed` y una ayuda que dice en qué días aplica (`promotion-form-modal.component.ts:427`).
  - Columna y detalle "Días" en el listado y la tarjeta ("Mar · Mié · Vie", "Entre semana", "Todos los días").
  - Mensajes para `PROMOTION_*` en `core/utils/error-messages.ts`.
- **Franja horaria:** no incluida (D8, P8).

## Tasks

- [x] T1 Auditoría y matriz (backend y frontend, con dos exploradores de solo lectura).
- [x] T2 Migración aditiva `active_weekdays`.
- [x] T3 Motor: zona horaria, días, `per_product`, stacking, vista previa, `applyPromotion` idempotente, límite por cliente, tarjeta de producto, errores tipados.
- [x] T4 Servicio admin: DTO, `/active`, resumen, `effective_state`, `activate`, `validate-code`.
- [x] T5 Usos: cancelar devuelve el uso; editor de órdenes y cobro de orden existente.
- [x] T6 Vitrina ecommerce.
- [x] T7 Frontend: chips, listado, limpiar opcionales al editar, mensajes y recarga del POS.
- [ ] Pendientes P1–P8 (abajo).

## Pendiente (no tocado en este PR)

- **P1 (A) — Cierre de mesa: la promo solo ve los productos nuevos.** `applyPosPaymentToTableSession` cotiza `dto.items` (`payments.service.ts:5556`) y no `existingItems` (`:5484`). Lo pedido antes en la mesa no recibe promos automáticas y el mínimo de compra se evalúa sobre un subtotal parcial. Arreglarlo implica re-cotizar las líneas persistidas con sus precios y escalas: hay que tocar el cobro de mesa y las cuentas divididas, con pruebas de caja.
- **P2 (M) — Carrera en el último cupo.** `usage_limit` se valida en memoria y `applyPromotion` incrementa sin guard: dos cajas simultáneas pueden pasarse del límite. Solución propuesta: `updateMany where usage_count < usage_limit` y verificar `count`, como ya hacen los cupones (`order-flow.service.ts`, `coupons.current_uses`).
- **P3 (M) — Ecommerce: el uso se registra fuera de la transacción.** `persistPromotionsAndCoupon` (`checkout.service.ts:1533`) corre después del commit de la orden; si falla, la orden queda con descuento pero sin uso registrado.
- **P4 (M) — Reembolso y devolución no devuelven el uso.** `refunds/**` y `orders/return-orders/**`; con un reembolso parcial hay que decidir si el uso vuelve.
- **P5 (M) — Vista previa del POS en el navegador.** `pos-cart.service.ts:1698+` duplica el motor y no conoce `quantity_grouping=per_product` ni el límite por cliente. Lo cobrado lo decide el backend, pero lo que el cajero ve antes de cobrar puede diferir. Solución propuesta: que el POS pida la cotización al backend.
- **P6 (B) — POS móvil cotiza sobre el neto** (no manda `final_unit_price`), y el web sobre el bruto. No se toca `apps/mobile`.
- **P7 (B) — Si el motor falla en el POS, se cobra sin descuento en silencio** (`calculatePosPromotionQuote`, `catch` → descuento 0). El editor sí rechaza.
- **P8 — Franja horaria** (hora de inicio y fin por día).

## Necesita decisión de Rafael

1. **Códigos de promoción vs cupones (D9).** Hoy el campo "Código" de una promoción no se puede usar en ninguna pantalla, y las promos manuales (`is_auto_apply = false`) no se aplican nunca. Los códigos que funcionan son los **cupones** (entidad aparte). Opciones:
   - (a) quitar el campo código y la opción "manual" de las promociones, y usar solo cupones;
   - (b) unificar los códigos en un solo campo del POS y del checkout, que busque primero en cupones y luego en promociones (el backend ya tiene `POST /store/promotions/validate-code`).
2. **Reembolso parcial y uso de la promo (P4):** ¿devuelve el uso o no?
3. **Prioridad de P1 (mesas).** Afecta a los restaurantes, que son justo el nicho de la promo por días.

## Log

- 2026-11-19:
  - Exploración backend y frontend (dos exploradores de solo lectura).
  - Línea base del spec del motor: 63/63.
  - Corregido el enlace roto `apps/frontend/node_modules` del worktree (apuntaba a `apps/Vendix/...`; solo en este worktree, ignorado por git).
- Tests corridos uno por uno, siempre con `jest.isolated.config.js --runInBand`:

  | Spec | Resultado |
  |---|---|
  | `promotion-engine.service.spec.ts` | 79/79 (16 nuevos; 11 de ellos fallan contra el motor de `b80dcfcae`) |
  | `promotions.service.spec.ts` (nuevo) | 5/5 |
  | `promotion-usage.util.spec.ts` (nuevo) | 3/3 |
  | `ecommerce-promotions.service.spec.ts` (nuevo) | 1/1 |
  | `orders.service.spec.ts` | 214/214 |
  | `orders.editor-discount.spec.ts` | 4/4 |
  | `order-flow.service.spec.ts` | 372/372 |
  | `order-flow-cancel-credit-note.spec.ts` | 14/14 |
  | `order-flow-forced-state.spec.ts` | 20/20 |
  | `payments.service.spec.ts` | 203/203 |
  | `checkout-gross-lines.spec.ts` | 4/4 |

- **Fallos previos, no causados por este PR:**
  - `catalog.service.spec.ts`: 2 fallos ("attaches active_promotion …").
  - `checkout-inclusive-line.parity.spec.ts`: 2 fallos.
  - Comprobado restaurando en el worktree los 12 archivos de backend modificados a su versión base (`b80dcfcae`) y corriendo los dos specs: fallan igual. `origin/develop` (`3f8cee361`) no cambió esas rutas.
- **Typecheck:**
  - Frontend: `buildcheck --frontend` (ngc AOT, plantillas estrictas) PASA.
  - Backend: `buildcheck --backend` se quedó sin memoria dos veces (3 GB y 5 GB de heap) en esta Mac; lo cubre CI. Además el cliente Prisma local es compartido con el checkout principal y no se regeneró con el schema nuevo.
