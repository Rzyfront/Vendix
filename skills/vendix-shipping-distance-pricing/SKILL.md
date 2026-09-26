---
name: vendix-shipping-distance-pricing
description: >
  Cobro de envío por distancia real (calles, no línea recta) en Vendix: escala de tramos por km
  en `shipping_rates.distance_tiers`, origen pineado por método (`shipping_methods.origin_*`),
  ruteo compartido Valhalla/OSRM (`RoutingService`) y la regla de cobertura al confirmar el
  checkout — rechazo estricto sin tolerancia (`ECOM_CHECKOUT_003`). Trigger: editar tramos de
  distancia, tocar `resolveConfirmShippingCost`, tocar `RoutingService`, depurar
  `ECOM_CHECKOUT_003`, o "cobro por km impreciso/inconsistente".
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Editing distance tiers or shipping_rates.distance_tiers"
    - "Working with resolveConfirmShippingCost in checkout.service.ts"
    - "Working with RoutingService (Valhalla/OSRM directions)"
    - "Debugging ECOM_CHECKOUT_003 errors on checkout"
    - "Debugging inaccurate or inconsistent distance-based shipping cost"
    - "Activating distance_pricing_enabled on a shipping method"
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
- Tocar `RoutingService` (Valhalla/OSRM) o su caché Redis.
- Depurar un 400 `ECOM_CHECKOUT_003` en checkout.
- "El cobro por km da un valor raro o inconsistente entre cotización y confirmación".
- Activar `distance_pricing_enabled` en un método de envío (exige origen pineado).

## Core Rules (decisiones de negocio — Rafael, 2026-09-26)

1. **Rechazo estricto de no cobertura, SIN tolerancia.** Si al confirmar la distancia cae fuera
   de todos los tramos → 400 `ECOM_CHECKOUT_003`
   (`apps/backend/src/common/errors/error-codes.ts:545-549`). El matcher es el puro
   `ShippingDistanceService.matchTier`
   (`apps/backend/src/domains/store/shipping/services/shipping-distance.service.ts:50-63`),
   llamado tal cual en `CheckoutService.resolveConfirmShippingCost`
   (`apps/backend/src/domains/ecommerce/checkout/checkout.service.ts:423`). **NO** agregar
   ninguna "gracia" en el borde del último tramo cerrado: se probó una tolerancia de 0.2 km
   (`matchTierWithTolerance`) y se revirtió por decisión explícita. Ver el test
   `apps/backend/src/domains/ecommerce/checkout/checkout-distance.spec.ts:492-523`
   ("rechazo estricto SIN tolerancia..."), que fija el `errorCode` exacto
   (`ECOM_CHECKOUT_003`), no solo la clase de la excepción, para que un futuro revert
   accidental a la tolerancia no pase la prueba con un código distinto. Si una tienda necesita
   cubrir más lejos, la solución es un tramo abierto (`to_km: null`), nunca una tolerancia
   oculta.
2. **La consistencia cotización↔confirmación se logra normalizando coordenadas, no con
   tolerancias.** `ShippingDistanceService.toCoords` (líneas 110-156 del mismo archivo) es el
   ÚNICO punto de normalización de coords — redondea a 6 decimales y corrige swap lat/lng — y
   lo usan por igual el cotizador
   (`apps/backend/src/domains/store/shipping/shipping-calculator.service.ts:380-467`,
   `resolveQuoteDistances`) y la confirmación (`checkout.service.ts:386-395`). Un mismo punto
   siempre produce la misma llave de caché de `RoutingService`, sin importar si viene del
   float de la cotización o del `Decimal(10,8)` persistido.
3. **Degradación a tarifa de zona cuando no se puede medir** (sin coords, sin origen, motor de
   ruteo caído), siempre con un log `warn` ESTRUCTURADO (`store_id`, `shipping_method_id`,
   `reason`) — nunca en silencio. Ver `resolveQuoteDistances`
   (`shipping-calculator.service.ts:416-421,436-441,458-463`) y
   `resolveConfirmShippingCost` (`checkout.service.ts:396-421`, evento
   `checkout.shipping_distance_unavailable`).
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

- Schema (`apps/backend/prisma/schema.prisma:3309` modelo; campos en `3340-3342`):
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

- `toCoords(lat, lng, label?)` (110-156): valida rango WGS84, detecta y corrige lat/lng
  invertido vía el bbox aproximado de Colombia (`COLOMBIA_BBOX`, 37-42 — heurística
  geográfica, NO un límite de cobertura de negocio), y redondea a 6 decimales (`round6`,
  165-167, ~0.1 m de precisión GPS).
- `resolveDistanceKm(origin, buyer)` (175-194): arma `"lng,lat;lng,lat"` y llama a
  `RoutingService.directions()`; devuelve `null` ante cualquier fallo (el llamador cobra
  zona).
- `resolveRatePrice(distanceTiers, distanceKm)` (201-212): `{ price }` si matchea, `{
  excluded: true }` si cae fuera de todos los rangos (la tarifa NO se ofrece), `null` si rige
  zona.

### Cotizador — `ShippingCalculatorService`

`apps/backend/src/domains/store/shipping/shipping-calculator.service.ts` — **NO** está bajo
`services/`, a diferencia de `shipping-distance.service.ts` y `shipping-tax.service.ts`.

- `resolveQuoteDistances` (380-467): UNA llamada de ruteo por ORIGEN distinto, compartida por
  todas las tarifas de la cotización (agrupa métodos por `origin.lat,lng`). Sin coords de
  destino o de origen, deja un `warn` con `store_id` + `shipping_method_id` + motivo
  (416-421, 436-441) y ese método cobra zona.
- `applyDistancePrice` (474-503): override del costo de zona por el precio del tramo. Si
  `resolveRatePrice` devuelve `'excluded'`, la tarifa se salta con `continue` en el loop de
  `calculateRates` (línea 270) — **fuera de rango en la COTIZACIÓN, la tarifa simplemente no
  aparece en las opciones de envío**, sin error visible; el 400 solo ocurre al CONFIRMAR (regla
  1).

### Confirmación — `CheckoutService.resolveConfirmShippingCost`

`apps/backend/src/domains/ecommerce/checkout/checkout.service.ts:334-431`. El backend
**RECALCULA siempre** al confirmar — nunca confía en el costo de envío que mandó el frontend.
Se llama desde AMBOS canales: checkout normal (línea 1908) y checkout por WhatsApp (línea 2804,
`wa_distanced`).

Orden de fallos (todos fail-open a zona, salvo el único caso de rechazo real):

1. Tarifa `free` → 0 sin rutear (línea 375).
2. Sin `ShippingDistanceService` inyectado o método sin `distance_pricing_enabled` → zona
   (378).
3. Escala corrupta/ausente → zona (379-380).
4. Sin coords de origen o de destino (`toCoords` devuelve `null`) → zona + warn
   `checkout.shipping_distance_unavailable` con `reason: origin_coords_missing` /
   `buyer_coords_missing` (386-402).
5. `resolveDistanceKm` lanza o devuelve `null` → zona + warn con `reason: routing_exception` /
   `routing_failed` (404-421).
6. Distancia fuera de todos los tramos (`matchTier` devuelve `null`) → **único caso que
   rechaza**: 400 `ECOM_CHECKOUT_003` (423-429). Esta es la regla 1: sin tolerancia.

### Destino — coords del checkout (frontend)

El destino sale de las coords de la dirección del checkout: el pin del mapa
(`app-address-map-picker`) o el forward-geocode de la dirección escrita — la **dirección
escrita es la verdad**, el pin solo afina las coords (ver `vendix-address-geocoding`). El
cotizador las recibe vía `POST /shipping/calculate` (`CartService.getShippingEstimates()`, ver
`vendix-ecommerce-checkout`); la confirmación las lee del snapshot de dirección de la orden
(`address_snapshot.latitude/longitude`, `Decimal(10,8)` en BD) — de ahí la importancia de
`toCoords` como normalizador único (regla 2): un float de cotización y su `Decimal(10,8)`
persistido deben producir la MISMA llave de caché.

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

## Decision Rules

| Situación | Comportamiento |
| --- | --- |
| Distancia dentro de un tramo | Cobra el precio de ESE tramo (zona no aplica). |
| Distancia fuera de TODOS los tramos, en cotización | La tarifa se excluye de las opciones (`excluded`); no se ofrece. |
| Distancia fuera de TODOS los tramos, al confirmar | 400 `ECOM_CHECKOUT_003`. Sin tolerancia. |
| Tarifa `free` con o sin escala | Cobra 0, nunca rutea. |
| Método sin `distance_pricing_enabled` | Cobra zona directamente, no rutea. |
| Sin coords (origen o destino) | Cobra zona + warn estructurado. |
| Motor de ruteo caído o lanza excepción | Cobra zona + warn estructurado. |
| Escala (`distance_tiers`) corrupta o ausente | Cobra zona (fail-open), sin romper checkout. |
| Activar `distance_pricing_enabled` sin origen pineado | 400 (`assertDistanceOriginPinned`). |
| Tienda quiere cubrir "más lejos" | Configurar un tramo abierto (`to_km: null`), no pedir tolerancia. |

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

## Related Skills

- `vendix-ecommerce-checkout` — flujo de checkout completo (normal + WhatsApp);
  `resolveConfirmShippingCost` es un paso más del recálculo de totales en servidor.
- `vendix-address-geocoding` — de dónde salen las coords del comprador (pin del mapa /
  forward-geocode) y las del snapshot de dirección de la orden.
- `vendix-error-handling` — `VendixHttpException` + `ErrorCodes` (`ECOM_CHECKOUT_003`).
- `vendix-validation` — patrón de DTO + validador `class-validator` custom
  (`IsValidDistanceTiers`).
- `vendix-backend-api` — convenciones de endpoints/servicios NestJS usadas en `shipping/*`.
