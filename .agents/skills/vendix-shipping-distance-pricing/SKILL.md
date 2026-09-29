---
name: vendix-shipping-distance-pricing
description: >
  Cobro de envío por distancia real (calles, no línea recta) en Vendix: escala de tramos por km
  en `shipping_rates.distance_tiers`, origen pineado por método (`shipping_methods.origin_*`),
  ruteo compartido Valhalla/OSRM (`RoutingService`), resolución compartida de coords del comprador
  (`ShippingDistanceService.resolveBuyerCoords`) y la regla de cobertura al confirmar el checkout —
  rechazo estricto sin tolerancia (`ECOM_CHECKOUT_003`) que desde 2026-09-27 también cubre "sin
  coordenadas del comprador, sin tarifa" (ya no degrada a zona). Trigger: editar tramos de
  distancia, tocar `resolveConfirmShippingCost`/`resolveBuyerCoords`, tocar `RoutingService`,
  depurar `ECOM_CHECKOUT_003`, o "cobro por km impreciso/inconsistente".
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke:
    - "Editing distance tiers or shipping_rates.distance_tiers"
    - "Working with resolveConfirmShippingCost in checkout.service.ts"
    - "Working with RoutingService (Valhalla/OSRM directions)"
    - "Debugging ECOM_CHECKOUT_003 errors on checkout"
    - "Debugging inaccurate or inconsistent distance-based shipping cost"
    - "Activating distance_pricing_enabled on a shipping method"
    - "Working with ShippingDistanceService.resolveBuyerCoords"
    - "Debugging a shipping rate excluded or missing because the buyer address could not be geocoded"
---

## Purpose

Gobierna el cobro de envío por distancia real en Vendix: la escala de tramos por km, el origen
pineado por método, el motor de ruteo compartido y la regla de cobertura al confirmar el
checkout. No cubre tipos de tarifa flat/weight/price-based ni el flujo de checkout en general
(`vendix-ecommerce-checkout`), ni la captura de dirección/geocoding del comprador
(`vendix-address-geocoding`) — esta skill cubre solo la pieza de PRECIO POR DISTANCIA que se
monta encima de esas dos.

## When to Use

- Editar tramos de distancia (`shipping_rates.distance_tiers`, `DistanceTierDto`).
- Tocar `CheckoutService.resolveConfirmShippingCost` (checkout normal o por WhatsApp).
- Tocar `ShippingDistanceService.resolveBuyerCoords` (resolución compartida de coords del comprador).
- Tocar `RoutingService` (Valhalla/OSRM) o su caché Redis.
- Depurar un 400 `ECOM_CHECKOUT_003` en checkout.
- "El cobro por km da un valor raro o inconsistente entre cotización y confirmación".
- Activar `distance_pricing_enabled` en un método de envío (exige origen pineado).
- Depurar una tarifa por distancia que desaparece de la cotización (`excluded`) o que rechaza el
  checkout porque no se pudo ubicar la dirección del comprador.

## Core Rules (decisiones de negocio — Rafael, 2026-09-26)

1. **Rechazo estricto de no cobertura, SIN tolerancia.** Si al confirmar la distancia cae fuera
   de todos los tramos → 400 `ECOM_CHECKOUT_003`
   (`apps/backend/src/common/errors/error-codes.ts:545-549`). El matcher es el puro
   `ShippingDistanceService.matchTier`
   (`apps/backend/src/domains/store/shipping/services/shipping-distance.service.ts:79-92`),
   llamado tal cual en `CheckoutService.resolveConfirmShippingCost`
   (`apps/backend/src/domains/ecommerce/checkout/checkout.service.ts:499`). **NO** agregar
   ninguna "gracia" en el borde del último tramo cerrado: se probó una tolerancia de 0.2 km
   (`matchTierWithTolerance`) y se revirtió por decisión explícita. Ver el test
   `apps/backend/src/domains/ecommerce/checkout/checkout-distance.spec.ts:513-544`
   ("rechazo estricto SIN tolerancia..."), que fija el `errorCode` exacto
   (`ECOM_CHECKOUT_003`), no solo la clase de la excepción, para que un futuro revert
   accidental a la tolerancia no pase la prueba con un código distinto. Si una tienda necesita
   cubrir más lejos, la solución es un tramo abierto (`to_km: null`), nunca una tolerancia
   oculta.
2. **La consistencia cotización↔confirmación se logra normalizando coordenadas, no con
   tolerancias.** `ShippingDistanceService.toCoords` (líneas 139-185 del mismo archivo) es el
   ÚNICO punto de normalización de coords — redondea a 6 decimales y corrige swap lat/lng — y
   lo usan por igual el cotizador
   (`apps/backend/src/domains/store/shipping/shipping-calculator.service.ts:436-552`,
   `resolveQuoteDistances`) y la confirmación (`checkout.service.ts:410-459`). Un mismo punto
   siempre produce la misma llave de caché de `RoutingService`, sin importar si viene del
   float de la cotización o del `Decimal(10,8)` persistido.
3. **Degradación a tarifa de zona SOLO cuando la razón es infraestructura** (sin origen del
   método, motor de ruteo caído/lanzando), siempre con un log `warn` ESTRUCTURADO (`store_id`,
   `shipping_method_id`, `reason`) — nunca en silencio. Ver `resolveQuoteDistances`
   (`shipping-calculator.service.ts:482-486,543-548`) y `resolveConfirmShippingCost`
   (`checkout.service.ts:415-421,483-497`, evento `checkout.shipping_distance_unavailable`).
   **Modificado por la regla 6**: sin coords del COMPRADOR (ni cliente ni geocodificables) ya
   NO degrada a zona — ver abajo.
4. **Nunca Haversine.** El precio se cobra por distancia REAL por calles, vía
   `RoutingService.directions()`
   (`apps/backend/src/domains/ecommerce/routing/routing.service.ts:141-156`), nunca por línea
   recta.
5. **Ruta estándar, no "shortest".** Valhalla usa costing `auto` estándar
   (`VALHALLA_AUTO_COSTING_OPTIONS`, vacío a propósito — `routing.service.ts:94-109,294-299`);
   el fallback OSRM toma la ruta PRIMARIA sin `alternatives=true` (`routing.service.ts:384-449`),
   no la de menor distancia entre alternativas. `shortest: true` se probó y se quitó: enviaba
   repartidores por vías no aptas (trochas, calles residenciales angostas) solo por ser unos
   metros más cortas.
6. **Sin coordenadas del comprador, sin tarifa — regla de negocio (owner, 2026-09-27).** Antes,
   sin coords del comprador (ni cliente ni geocode) el método con distancia degradaba a precio de
   zona igual que un motor de ruteo caído. Ya NO: es un caso de **negocio** (no sabemos dónde
   entregar), no de infraestructura, así que:
   - **Cotización** (`ShippingCalculatorService.resolveQuoteDistances`,
     `shipping-calculator.service.ts:436-552`): si `ShippingDistanceService.resolveBuyerCoords`
     no resuelve nada, CADA tarifa con distancia activa se marca con el centinela
     `'buyer_geocode_failed'` (visto por `applyDistancePrice`, `shipping-calculator.service.ts:562-592`)
     y `calculateRates` la excluye — igual que "fuera de todos los tramos": la tarifa simplemente
     no aparece entre las opciones.
   - **Confirmación** (`CheckoutService.resolveConfirmShippingCost`, `checkout.service.ts:376-507`):
     si `resolveBuyerCoords` no resuelve nada, se rechaza con el MISMO 400 `ECOM_CHECKOUT_003`
     (`checkout.service.ts:462-479`), mensaje exacto: *"No pudimos ubicar la dirección de entrega.
     Marca la ubicación en el mapa para calcular el envío."* Test que fija esta regla:
     `checkout-distance.spec.ts:411-436` ("cambio de negocio 2026-09-27: ... buyer_geocode_failed
     ... YA NO cobra zona").
   - **Sin ORIGEN del método** o **motor de ruteo caído** siguen degradando a zona (regla 3, sin
     cambios) — eso sigue siendo infraestructura, no la dirección del comprador.
   - Ver `vendix-address-geocoding` para el contrato completo de `resolveBuyerCoords`/`forward` y
     para las reglas de UX del frontend (bloqueo de Continuar, badge de precisión, GPS con consentimiento).

7. **Sin ubicación del comprador + WhatsApp checkout activo → pedido "envío por asignar" (owner,
   2026-09-27).** Cuando el comprador pide "Usar mi ubicación automática" y la geolocalización es
   denegada / no soportada / falla, y la tienda tiene `ecommerce.checkout.whatsapp_checkout = true`
   con `whatsapp_number` no vacío, el checkout ofrece mandar el pedido por WhatsApp SIN tarifa:
   - **Contrato (sin migración):** `POST` checkout con `channel: 'whatsapp'` +
     `pending_shipping_assignment: true`, sin `shipping_method_id`/`shipping_rate_id` y sin
     `payment_method_id`. La orden queda `delivery_type='other'`, `shipping_method_id = NULL`,
     `shipping_cost = 0`, `state='pending_payment'`, SIN fila en `payments` y SIN factura
     automática; `orders.notes` explica que el envío está pendiente de asignar.
   - **Guard servidor:** `CheckoutService.assertPendingShippingAssignmentAllowed`
     (`checkout.service.ts:948`, llamado en `runCheckout`) exige canal whatsapp, sin
     método/tarifa, y tienda con WhatsApp checkout activo + número; si no → 400
     `ECOM_CHECKOUT_PENDING_SHIPPING_001`. El backend nunca confía en que el frontend haya
     gateado el botón.
   - **Compuertas que sostienen el estado:** `'other'` NO está en
     `SHIPPING_METHOD_EXEMPT_DELIVERY_TYPES`, así que cobrar (`ORD_SHIP_CHARGE_001`), despachar
     (`ORD_SHIP_REQUIRED_001`) y remisionar (`dispatch-notes.service.ts` `createFromOrder` + pool,
     `ORD_SHIP_REQUIRED_001`) quedan bloqueados hasta que la tienda asigne método y tarifa desde
     el detalle de la orden (`assignShipping`). Si la orden ya tiene pagos, cambiar el costo de
     envío se rechaza con `ORD_SHIP_CHARGED_COST_CHANGE_001`.
   - **Cron:** `payment-timeout-cleanup.job.ts` excluye `delivery_type='other' AND
     shipping_method_id IS NULL` del auto-cancel de 2 h — la tienda coordina por chat y puede
     tardar más.
   - Este fallback NO relaja la regla 6: sin WhatsApp checkout activo el comprador debe marcar el
     mapa; no hay tarifa de zona como salida.

## Architecture

### Escala de tramos — `shipping_rates.distance_tiers`

- DTO `DistanceTierDto`
  (`apps/backend/src/domains/store/shipping/dto/store-shipping-zones.dto.ts:80-109`) —
  `{ from_km, to_km: number|null, price }`, máx. 20 tramos (`@ArrayMaxSize(20)`).
- Validador `IsValidDistanceTiers` (mismo archivo, líneas 118-174): la escala debe ser
  **contigua** (el `from_km` de un tramo == el `to_km` del anterior, sin huecos ni traslapes),
  **ordenada**, el **primer tramo arranca en 0**, y **`to_km: null` (tramo abierto) solo puede
  ir al final**.
- `ShippingDistanceService.parseTiers` (`shipping-distance.service.ts:69-92`) normaliza el JSON
  crudo a runtime; cualquier corrupción (números inválidos, `to_km <= from_km`, etc.) devuelve
  `null` → rige el precio de zona (fail-open), NUNCA rompe la cotización ni la confirmación.
- Matcher puro `matchTier` (líneas 50-63): primer tramo con `from_km <= d` y (`to_km == null` o
  `d < to_km`).

### Origen — `shipping_methods.origin_latitude/longitude`

- Schema (`apps/backend/prisma/schema.prisma:3311` modelo; campos en `3342-3344`):
  `distance_pricing_enabled Boolean @default(false)`, `origin_latitude Decimal(10,8)?`,
  `origin_longitude Decimal(11,8)?`. Apagado por defecto, configurable POR MÉTODO (no por
  tienda).
- `assertDistanceOriginPinned`
  (`apps/backend/src/domains/store/shipping/services/store-shipping-methods.service.ts:21-34`):
  no se puede activar `distance_pricing_enabled` sin origen pineado. Se valida sobre los
  valores YA MEZCLADOS (DTO + existente) para cubrir updates parciales; se llama desde
  `enableForStore` (línea 199) y `updateStoreMethod` (línea 445).

### Resolución compartida — `ShippingDistanceService`

`apps/backend/src/domains/store/shipping/services/shipping-distance.service.ts`. Es el único
punto que usan tanto el cotizador como la confirmación:

- `toCoords(lat, lng, label?)` (139-185): valida rango WGS84, detecta y corrige lat/lng
  invertido vía el bbox aproximado de Colombia (`COLOMBIA_BBOX`, 63-68 — heurística
  geográfica, NO un límite de cobertura de negocio), y redondea a 6 decimales (`round6`,
  193-196, ~0.1 m de precisión GPS).
- `resolveDistanceKm(origin, buyer)` (204-223): arma `"lng,lat;lng,lat"` y llama a
  `RoutingService.directions()`; devuelve `null` ante cualquier fallo (el llamador cobra
  zona — esto SÍ sigue siendo infraestructura, regla 3).
- **`resolveBuyerCoords(address, bias?)` (243-282)** — resolución COMPARTIDA de las coords del
  comprador, usada tanto por el cotizador como por la confirmación (mismos campos de entrada,
  mismo `bias`):
  1. El pin/coords que el comprador YA mandó **siempre gana** (`source: 'client'`) — puede ser un
     pin confirmado a mano, más confiable que un forward-geocode.
  2. Solo si no hay coords utilizables, intenta `GeocodingService.forward(address_line1, city,
     state_province, { bias })` (`source: 'geocoded'`). Falla (retorna `null`) si: no hay
     `GeocodingService` inyectado, `country_code` está presente y NO es `'CO'` (**CO only** — un
     comprador de otro país nunca dispara el geocode Colombia-only), no hay `address_line1`, o el
     geocoder no resuelve nada.
  3. Usar el MISMO helper con el MISMO `bias` desde cotizador y confirmación es lo que las hace
     medir desde el mismo punto: `GeocodingService.forward` cachea por dirección normalizada, así
     que la llamada de la confirmación es normalmente un HIT del resultado que ya vio el
     cotizador (ver `vendix-address-geocoding`, cache key `geocode:fwd:vN:`).
  4. `null` cuando ninguna de las dos vías resuelve — el llamador YA NO cobra zona con esto
     (regla 6): decide excluir la tarifa (cotizador) o rechazar 400 (confirmación).
- `resolveRatePrice(distanceTiers, distanceKm)` (289-300): `{ price }` si matchea, `{
  excluded: true }` si cae fuera de todos los rangos (la tarifa NO se ofrece), `null` si rige
  zona.

### Cotizador — `ShippingCalculatorService`

`apps/backend/src/domains/store/shipping/shipping-calculator.service.ts` — **NO** está bajo
`services/`, a diferencia de `shipping-distance.service.ts` y `shipping-tax.service.ts`.

- `resolveQuoteDistances` (436-552): UNA llamada de ruteo por ORIGEN distinto, compartida por
  todas las tarifas de la cotización (agrupa métodos por `origin.lat,lng`). Sin coords de
  ORIGEN (método sin pinear), deja un `warn` con `store_id` + `shipping_method_id` + motivo
  (482-486) y ese origen cobra zona (infraestructura, regla 3, sin cambios). Sin coords del
  COMPRADOR (ni cliente ni `resolveBuyerCoords`), CADA tarifa candidata con ese origen se marca
  `'buyer_geocode_failed'` (516-530) — regla 6, ya NO cobra zona.
- `applyDistancePrice` (562-592): override del costo de zona por el precio del tramo. Si
  `distanceEntry === 'buyer_geocode_failed'` (583) o si `resolveRatePrice` devuelve
  `'excluded'` (590), la tarifa se salta con `continue` en el loop de `calculateRates` (línea
  277) — **fuera de rango o sin coords del comprador en la COTIZACIÓN, la tarifa simplemente no
  aparece en las opciones de envío**, sin error visible; el 400 solo ocurre al CONFIRMAR (reglas
  1 y 6).
- `quoteRateGross` (390-405, doc en 366-389): `null` cuando la tarifa no aparece entre las
  opciones — incluye ahora el caso "sin coords del comprador" (comentario explícito de 2026-09-27
  en el doc de la función); el llamador (payments/orders/order-flow, ver abajo) YA NO debe
  inventar un costo cuando la razón es la dirección del comprador.

### Confirmación — `CheckoutService.resolveConfirmShippingCost`

`apps/backend/src/domains/ecommerce/checkout/checkout.service.ts:376-507`. El backend
**RECALCULA siempre** al confirmar — nunca confía en el costo de envío que mandó el frontend.
Se llama desde AMBOS canales: checkout normal (línea 1984) y checkout por WhatsApp (línea 2880,
`wa_distanced`).

Orden de fallos (todos fail-open a zona salvo los DOS casos de rechazo real):

1. Tarifa `free` → 0 sin rutear (línea 399).
2. Sin `ShippingDistanceService` inyectado o método sin `distance_pricing_enabled` → zona
   (402).
3. Escala corrupta/ausente → zona (403-404).
4. Sin coords de ORIGEN (`toCoords` devuelve `null`) → zona + warn
   `checkout.shipping_distance_unavailable` con `reason: origin_coords_missing` (415-421).
   Infraestructura — regla 3, sin cambios.
5. **Sin coords del COMPRADOR** (snapshot vacío Y `resolveBuyerCoords` no resuelve nada) →
   **YA NO zona (regla 6)**: 400 `ECOM_CHECKOUT_003` con
   `reason: buyer_geocode_failed` en el warn (429-477), mensaje exacto: *"No pudimos ubicar la
   dirección de entrega. Marca la ubicación en el mapa para calcular el envío."* Cuando el geocode
   SÍ resuelve, el punto se escribe de vuelta en `address_snapshot.latitude/longitude` (mismo
   objeto que luego persiste `orders.shipping_address_snapshot`) para que la orden quede con
   coords aunque el comprador nunca las haya mandado (452-459).
6. `resolveDistanceKm` lanza o devuelve `null` → zona + warn con `reason: routing_exception` /
   `routing_failed` (483-497). Infraestructura — regla 3, sin cambios.
7. Distancia fuera de todos los tramos (`matchTier` devuelve `null`) → **rechazo por regla 1**:
   400 `ECOM_CHECKOUT_003` (499-505), mensaje distinto ("vuelve a cotizar el envío").

### Destino — coords del checkout (frontend)

El destino sale de las coords de la dirección del checkout: el pin del mapa
(`app-address-map-picker`) o el forward-geocode de la dirección escrita — la **dirección
escrita es la verdad**, el pin solo afina las coords (ver `vendix-address-geocoding`). El
cotizador las recibe vía `POST /shipping/calculate` (`CartService.getShippingEstimates()`, ver
`vendix-ecommerce-checkout`); la confirmación las lee del snapshot de dirección de la orden
(`address_snapshot.latitude/longitude`, `Decimal(10,8)` en BD) — de ahí la importancia de
`toCoords` como normalizador único (regla 2): un float de cotización y su `Decimal(10,8)`
persistido deben producir la MISMA llave de caché.

**`address_line1` debe viajar en los objetos de cotización backend** — sin él,
`resolveBuyerCoords` no tiene nada que geocodificar cuando faltan coords (regla 6). Los tres
puntos donde el editor de órdenes arma la dirección para `quoteRateGross`
(`ShippingCalculatorService.quoteRateGross`) ya la incluyen explícitamente:

- `apps/backend/src/domains/store/payments/payments.service.ts:4905,4975` — DTO de dirección +
  mapeo `address_line1: address.address_line1 || undefined`.
- `apps/backend/src/domains/store/orders/orders.service.ts:3099-3154,4926` — dos puntos:
  `shippingAddressForCalc` (edición de orden) y el bloque de cotización del checkout normal.
- `apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts:3171-3225` — mismo
  patrón para el flujo de order-flow.

Si un nuevo caller arma su propio objeto de dirección para cotizar/confirmar y omite
`address_line1`, `resolveBuyerCoords` retorna `null` en cuanto falten coords explícitas — la
tarifa se excluye o el checkout rechaza (regla 6) por un campo faltante que nada tiene que ver
con la distancia real.

### Motor de ruteo — `RoutingService`

`apps/backend/src/domains/ecommerce/routing/routing.service.ts`.

- Primario: Valhalla (`VALHALLA_BASE`, línea 94), costing `auto` estándar,
  `costing_options.auto` vacío a propósito (109, 294-299) — NUNCA `shortest: true`.
- Fallback: OSRM (`OSRM_BASE`, línea 89) si Valhalla falla (`fetchLeg`, 197-206); toma la ruta
  PRIMARIA sin `alternatives=true` (442-449), no la de menor distancia entre alternativas.
- Caché Redis 24 h (`CACHE_TTL_SECONDS = 86400`, línea 79), prefijo `routing:directions:v3:`
  (línea 117 — el `v3` marca la era post-`shortest`, para que geometría vieja no se sirva tras
  el cambio de política). Llave = hash SHA-256 de las coords YA redondeadas/normalizadas
  (`resolveLeg`, 162-190; `normalizeCoords`, 237-263).
- Single-flight lock best-effort (`acquireLock`, 497-511) para evitar thundering herd en rutas
  concurrentes idénticas.
- Multi-leg: cada par consecutivo de waypoints se resuelve y cachea POR SEPARADO (`directions`,
  141-156) — mejora el reuso cuando solo cambia el primer tramo de la ruta.

### Frontend — gating de "sin coords, sin tarifa" (regla 6)

La UI bloquea el avance ANTES de llamar al backend, para no depender solo del 400 de confirmación:

- **POS** — `pos-shipping-step.component.ts` (línea 282): `computed` `hasResolvedLocation` exige
  coords válidas (del pin o del geocode) antes de dejar cotizar/cobrar distancia; mientras no
  hay coords el total muestra literal "Pendiente" en vez de un monto o un cero engañoso. El
  componente monta `app-address-form-fields` con `[allowGeolocation]="false"` (GPS del navegador
  deshabilitado en punto de venta — el vendedor ubica al cliente en el mapa, no su propio
  dispositivo).
- **Checkout ecommerce** — `checkout.component.ts` (líneas 1631, 1650, 1669): tres `computed`
  encadenados — `hasResolvedCoords` (¿hay lat/lng?), `shippingBlockedReason` (mensaje que explica
  POR QUÉ no se puede cotizar: sin coords, sin mapa confirmado, etc.) y
  `canProceedFromAddressStep` (gate final que habilita el botón "Continuar"). Igual que en POS,
  esto es enforcement en la UI del mismo contrato que el backend aplica en
  `resolveConfirmShippingCost` — un bypass de este gate (ej. saltar el step por routing) NO evita
  el 400 `ECOM_CHECKOUT_003`, solo cambia dónde se entera el comprador.
- El pin/badge de precisión y el resto de la UX de mapa (candado `pinConfirmed`, geolocalización
  del navegador, badges de precisión) son genéricos y viven documentados en
  `vendix-address-geocoding` — esta subsección cubre solo el gate de "no hay tarifa sin coords"
  específico de esta skill.

## Decision Rules

| Situación | Comportamiento |
| --- | --- |
| Distancia dentro de un tramo | Cobra el precio de ESE tramo (zona no aplica). |
| Distancia fuera de TODOS los tramos, en cotización | La tarifa se excluye de las opciones (`excluded`); no se ofrece. |
| Distancia fuera de TODOS los tramos, al confirmar | 400 `ECOM_CHECKOUT_003`. Sin tolerancia (regla 1). |
| Tarifa `free` con o sin escala | Cobra 0, nunca rutea. |
| Método sin `distance_pricing_enabled` | Cobra zona directamente, no rutea. |
| **Sin coords del COMPRADOR** (ni cliente ni `resolveBuyerCoords`), en cotización | **Regla 6** — la tarifa se marca `'buyer_geocode_failed'` y se excluye, igual que fuera de rango. |
| **Sin coords del COMPRADOR** (ni cliente ni `resolveBuyerCoords`), al confirmar | **Regla 6** — 400 `ECOM_CHECKOUT_003`, "Marca la ubicación en el mapa...". YA NO cobra zona. |
| Sin coords de ORIGEN (método sin pinear) | Cobra zona + warn estructurado (infraestructura, regla 3, sin cambios). |
| Motor de ruteo caído o lanza excepción | Cobra zona + warn estructurado (infraestructura, regla 3, sin cambios). |
| Escala (`distance_tiers`) corrupta o ausente | Cobra zona (fail-open), sin romper checkout. |
| Activar `distance_pricing_enabled` sin origen pineado | 400 (`assertDistanceOriginPinned`). |
| Tienda quiere cubrir "más lejos" | Configurar un tramo abierto (`to_km: null`), no pedir tolerancia. |
| Falta `address_line1` en el objeto de dirección pasado a cotizar/confirmar | `resolveBuyerCoords` no puede geocodificar — mismo resultado que "sin coords del comprador" (regla 6). |

## Gotchas

- **Llave de caché con coords SIN redondear = cotización ≠ confirmación.** Si un caller nuevo
  arma el string de ruteo sin pasar por `toCoords` primero, el float completo de la cotización
  y el `Decimal(10,8)` del snapshot producen llaves de caché distintas en `RoutingService` →
  pueden medir distancias ligeramente distintas → un comprador que confirma la MISMA dirección
  que cotizó podría cruzar un borde de tramo. Siempre normalizar con `toCoords` antes de
  rutear, nunca "arreglar" esto con una tolerancia (ver regla 1 y 2).
- **Lat/lng invertido pasa la validación WGS84 individual en Colombia.** `lat≈4.7, lng≈-74.1`
  invertido a `lat≈-74.1, lng≈4.7` sigue siendo un par válido dentro de `-90..90`/`-180..180`
  cada uno por separado — la única señal de swap es geográfica (bbox de Colombia), no de rango.
  Si se agrega otro país sin bbox propio, esta detección deja de aplicar y queda como
  validación de rango simple.
- **APIs públicas sin SLA.** Valhalla (`valhalla1.openstreetmap.de`) y OSRM
  (`router.project-osrm.org`) son demos keyless de FOSSGIS/OSM, sin garantía de disponibilidad.
  El fail-open a zona (regla 3) no es opcional: sin él, una caída del proveedor público
  rompería el checkout completo para cualquier tienda con distancia activa.
- **Caída a zona silenciosa si se quita el log.** El fail-open a zona es intencional y
  correcto, pero SOLO es diagnosticable con el `warn` estructurado
  (`store_id`+`shipping_method_id`+`reason`). Si se refactoriza `resolveQuoteDistances` o
  `resolveConfirmShippingCost` y se pierde ese log, un método completo puede terminar cobrando
  zona en vez de distancia sin que nadie lo note hasta una auditoría de ingresos.
- **`shipping-calculator.service.ts` NO vive bajo `services/`**, a diferencia de
  `shipping-distance.service.ts` y `shipping-tax.service.ts` (que sí) — confundir la ruta al
  importar es un error común.
- **El 400 solo ocurre en la CONFIRMACIÓN, no en la cotización.** Si el frontend cotiza bien
  pero el comprador tarda y la geometría de ruteo cambia levemente (redespliegue del
  proveedor, caché expirada), la confirmación puede rechazar una tarifa que sí se había
  mostrado. Es el trade-off consciente de la regla 1: rechazo estricto sobre tolerancia oculta.
- **No confundir "sin coords del comprador" (regla 6, rechaza) con "sin coords de origen o motor
  de ruteo caído" (regla 3, degrada a zona)** — son ramas DISTINTAS en
  `resolveConfirmShippingCost` y en `resolveQuoteDistances`, con razones de negocio opuestas (no
  sabemos dónde entregar vs. problema de infraestructura nuestro). Un refactor que las colapse en
  un solo fail-open reintroduciría silenciosamente la degradación a zona que el owner pidió
  eliminar el 2026-09-27.
- **`resolveBuyerCoords` requiere `address_line1` explícito** en el objeto de dirección — un
  objeto de cotización armado a mano que solo pasa `latitude`/`longitude` (sin fallback de texto)
  pierde la capacidad de geocodificar cuando esas coords vienen vacías, cayendo directo en la
  regla 6 por un campo omitido, no por una dirección realmente irresoluble.
- **El `bias` pasado a `resolveBuyerCoords` debe ser el MISMO en cotizador y confirmación** (el
  origen del primer método candidato en la cotización, el origen del método YA ELEGIDO en la
  confirmación) — de lo contrario la llave de caché de `GeocodingService.forward` puede diferir
  (ver `vendix-address-geocoding`, `bias` en la llave de caché solo sin `city`/`municipality_code`)
  y cotización↔confirmación medirían desde puntos distintos, reabriendo el problema que la regla
  2 existe para evitar.

## Related Skills

- `vendix-ecommerce-checkout` — flujo de checkout completo (normal + WhatsApp);
  `resolveConfirmShippingCost` es un paso más del recálculo de totales en servidor.
- `vendix-address-geocoding` — de dónde salen las coords del comprador (pin del mapa /
  forward-geocode), el contrato de precisión (`GeocodePrecision`/`source`/`label`), el cascade
  completo que consume `resolveBuyerCoords`, y las reglas de UX frontend (bloqueo de Continuar,
  badge de precisión) que este cambio de negocio activó para envío a domicilio.
- `vendix-error-handling` — `VendixHttpException` + `ErrorCodes` (`ECOM_CHECKOUT_003`).
- `vendix-validation` — patrón de DTO + validador `class-validator` custom
  (`IsValidDistanceTiers`).
- `vendix-backend-api` — convenciones de endpoints/servicios NestJS usadas en `shipping/*`.
- `vendix-redis-quota` — patrón INCR+EXPIRE que también usa el tope mensual del fallback Google
  de `vendix-address-geocoding` (mismo tipo de contador periódico).
