# E.1 SA2 — Enumeración cerrada de consumidores `pickup` + unificación de etiquetas

- Step: E.1 («Para llevar» es direct_delivery) · ADR-01 (aceptado) · F-011 (vocabulario)
- Fecha: 2026-09-24 · Scope SA2: solo strings de etiqueta pickup + enumeración
- Grep base: `evidence/E.1-SA2-grep-pickup.txt` (38 líneas, `grep -rn "'pickup'"` en pos+orders)
- `order_items.is_takeaway`: NO tocado (ningún edit cerca; DB-10 intacto)

## 1. Unificación de las 4 etiquetas F-011 → `Recogida en tienda`

| # | F-011 (auditoría 2026-09-19) | Estado actual | Acción SA2 |
|---|---|---|---|
| 1 | `Recogida en tienda` — `settings/shipping/services/shipping-methods.service.ts:205` (`getShippingMethodTypeLabel`) | Sigue en `:206`, ya canónica | Sin cambio |
| 2 | `Recoger en tienda` — snapshot `pos-shipping-step.component.ts:593` | Había derivado a `:765` (`buildShippingAddress`, `address_line1`) | **Cambiada a `Recogida en tienda`** |
| 3 | `Retiro en tienda` — `:627` | Ya no existe en `pos-shipping-step` (refactor post-auditoría; `git log -S` no registra esa cadena en ese archivo). Ocurrencias actuales fuera de scope SA2 (ver §4) | Sin cambio (otro owner) |
| 4 | `Confirmar Recogida` — `:1046` | Ya normalizada a `Confirmar recogida` por `42f9bc008` en `orders/pages/order-details/order-details-page.component.ts:1103` (+ `Confirmar recogida en tienda` en el html `:2889`) | Cerrada por otro; `order-details.*` prohibido para SA2 |

Cambios aplicados (3 líneas, solo strings TS, cero templates):

- `pos/.../pos-checkout-shell/steps/pos-shipping-step.component.ts:765` — snapshot `address_line1: 'Recoger en tienda'` → `'Recogida en tienda'`
- `settings/shipping/components/shipping-methods-modal.component.ts:175` — `getTypeLabel`, `pickup: 'Recogida'` → `'Recogida en tienda'` (confirmado: mapa de tipo de método de envío, mismo key-set que el canónico)
- `settings/shipping/pages/shipping-dashboard/shipping-dashboard.component.ts:791` — `getTypeLabel`, `pickup: 'Recogida'` → `'Recogida en tienda'` (confirmado: mismo caso)
- `settings/shipping/services/shipping-methods.service.ts:206` — verificado canónico, sin cambio

NO tocado por prohibición de scope: `resolveDeliveryType` (`:757-758`, sigue devolviendo `pickup` para método pickup), gates de alias (F.2, otro step), `pos-checkout-shell.*`, `cart.model.ts`, `order-details.*`, specs, backend.

## 2. Cajón 1 — ESCRIBE `pickup` (cierra en E.1)

| Archivo:línea | Qué hace | Estado |
|---|---|---|
| `pos/.../pos-checkout-shell/pos-checkout-shell.component.ts:1417` | Escritor del editor: era `choice === 'mesa' ? 'dine_in' : 'pickup'` | **Cerrado** — ya estampa `direct_delivery` (`42f9bc008`, otro owner) |
| `pos/.../pos-checkout-shell/pos-checkout-shell.component.ts:1445` | `delivery_type: context.deliveryType` — passthrough del contexto Envío | Legítimo (puente; escribe `pickup` solo si el método real es pickup). No tocar |
| `pos/.../steps/pos-shipping-step.component.ts:758` | `resolveDeliveryType`: método pickup → `'pickup'` | Legítimo → cajón 3. No tocar |

Ningún escritor ilegítimo restante: cajón 1 sin deuda.

## 3. Cajón 2 — LEE `pickup` como llevar (VACÍO tras E.1)

Todos los lectores históricos verificados uno por uno; ninguno confunde ya `pickup` con «llevar»:

| Lector | Archivo:línea | Evidencia de cierre |
|---|---|---|
| Mapeo inverso carrito | `pos/models/cart.model.ts:272-273` | `case 'pickup': return 'enviar'` — vuelve al carril Enviar, nunca a Para llevar |
| Tipo FE tienda | `store/orders/interfaces/order.interface.ts:5` | `DeliveryType` con los 5 valores, incluido `dine_in` |
| Tipo FE org | `organization/orders/interfaces/order.interface.ts:61` | `DeliveryType` con los 5 valores |
| Etiquetas detalle | `orders/pages/order-details/order-details-page.component.ts:165-167,185,1102-1103` | pickup `Recogida en tienda` / `Lista para recogida` / `Confirmar recogida` vs direct `Entrega directa en mostrador` / `Confirmar Entrega` (`42f9bc008`) |
| Disparador mostrador | `shared/services/print/dispatch-ticket-autoprint.ts:97` | `counterTypes = ['direct_delivery', 'pickup']` reconoce el llevar nuevo Y el pickup real (rama opt-in); no colapsa |
| Badge KDS | `restaurant-ops/kds/components/kds-ticket-card/kds-ticket-card.component.ts:47-54`, `kds-ticket-detail-modal.component.ts:152-155` | `direct_delivery`→PARA LLEVAR, `home_delivery`→ENVÍO, `pickup`→sin badge |

**Cajón 2: vacío.** Deuda cero.

## 4. Cajón 3 — `pickup` LEGÍTIMO (no tocar)

Recogida diferida real por método de envío. Cualquier cambio aquí rompe remisión/despacho/KDS.

**Paso Envío POS** (`pos/.../steps/pos-shipping-step.component.ts` + `.html`):

- `:142` preserva `deliveryType 'pickup'` sin dirección · `:162-163` `isPickupMethod` · `:168` `requiresAddress` excluye pickup · `:410` rama método pickup · `:477,491` sin cálculo de flete · `:583` sin quote · `:756-758` `resolveDeliveryType` · `:763-765` snapshot pickup · `:820,858,865` gates de dirección/alias · html `:147,163,175,193,200` gates `isPickupMethod()`

**Shell / carrito (referencia, otro owner):**

- `pos-checkout-shell.component.ts:1431-1432` preserva pickup histórico sin método · `:1439` chequeo `newShipping` · `cart.model.ts:272-273` pickup→enviar · `pos/models/shipping.model.ts:4` union incluye `'pickup'`

**Detalle de orden (prohibido, otro owner):**

- `order-details-page.component.ts:149` lista sin-despacho · `:165-167` steps pickup · `:185` label · `:944,1011-1015` manual-ready-pickup · `:1062-1063,1102-1103` `Confirmar recogida` · `:1194` case pickup · `:1429-1440` predicado auto-impresión · `:1890` · `:2489-2493` auto-finalize pickup+pagada · `:3620` badge · html `:2888,2907`

**Impresión / settings / KDS:**

- `dispatch-ticket-autoprint.ts:87-88` (default: pickup no imprime) y `:97` (opt-in mostrador: pickup real sí)
- `shipping-methods.service.ts:195,206` · `shipping-methods-modal.component.ts:153,164,175` · `shipping-dashboard.component.ts:791,808,818,828` · `shipping-methods.interface.ts:3` enum `PICKUP`
- `kds/interfaces/kitchen-ticket.interface.ts:20,176` · card `:47-54` · modal `:152-155`

**Backend (solo referencia, prohibido):**

- `order-flow.service.ts:115-119` `SHIPPING_METHOD_EXEMPT_DELIVERY_TYPES` {pickup, direct_delivery, dine_in} · `:1394-1398` `requiresFulfillment` (pickup→`processing`) · `:2082` acción `ready_for_pickup`
- `dispatch-notes.service.ts:2058` exime a pickup de exigir dirección
- `orders-bulk.service.ts:356` exime a pickup de dirección
- `payments.service.ts:4652` default `direct_delivery` preservando pickup real · `:4110`

**Homónimo — NO es `delivery_type`, no tocar:** `CheckoutIntent = 'pickup' | 'delivery'` (`pos-checkout-shell.component.ts:55`, `pos-payment-step.component.ts:97,214,710`, html `:96`) = intent UX de cobro, ortogonal al enum de entrega.

## 5. Divergencias residuales fuera de scope SA2 (para otro owner/step)

- `settings/general/components/general-settings-form/general-settings-form.component.html:65,71` `Retiro en Tienda` (heading) y `:75` «Recoger en tienda» — no está en la lista cerrada de archivos SA2
- `private/modules/ecommerce/pages/account/order-detail/order-detail.component.ts:105-106` `Retiro en tienda` (+ `:105` `¡Tu pedido está listo para recoger!`) — lado comensal/ecommerce
- `pos-shipping-step.component.spec.ts:290` mock `name: 'Recoger'` — dato mock, no etiqueta; specs prohibidos. Sin aserción sobre el snapshot `:765`, el cambio no rompe el spec
- Comentarios con «retiro» (`dispatch-ticket-autoprint.ts:87`, `order-details-page.component.ts:757`, `pos-shipping-step.component.ts:756`) — prosa, no UI

## 6. Verificación SA2

- `zoneless-audit.sh`: NO corrido — solo se tocaron strings TS, cero templates (instrucción del step)
- Post-edit: las 4 ubicaciones SA2 responden `Recogida en tienda`; `grep "pickup: 'Recogida'"` en settings → vacío
- Sintaxis: edits de un solo string dentro de literales existentes; sin cambios de forma, tipos ni flujo
