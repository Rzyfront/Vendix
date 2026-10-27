# Arquitectura del cobro por distancia

Los números de línea cambian: busca por símbolo.

## Tramos — `shipping_rates.distance_tiers`

- `DistanceTierDto` (`apps/backend/src/domains/store/shipping/dto/store-shipping-zones.dto.ts`): `{ from_km, to_km: number|null, price }`, máx. 20 (`@ArrayMaxSize(20)`).
- `IsValidDistanceTiers` (mismo archivo): escala contigua (`from_km` = `to_km` anterior), ordenada, primer tramo desde 0, `to_km: null` solo al final.
- `ShippingDistanceService.parseTiers`: normaliza el JSON; corrupción → `null` → rige zona (fail-open).
- `matchTier` (puro): primer tramo con `from_km <= d` y (`to_km == null` o `d < to_km`).

## Origen — `shipping_methods`

- `distance_pricing_enabled Boolean @default(false)`, `origin_latitude Decimal(10,8)?`, `origin_longitude Decimal(11,8)?`. Por método, no por tienda.
- `assertDistanceOriginPinned` (`services/store-shipping-methods.service.ts`): no se activa sin origen; valida sobre valores ya mezclados (DTO + existente); llamado en `enableForStore` y `updateStoreMethod`.

## `ShippingDistanceService` (`apps/backend/src/domains/store/shipping/services/shipping-distance.service.ts`)

- `toCoords(lat, lng, label?)`: valida WGS84, corrige swap lat/lng con `COLOMBIA_BBOX` (heurística, no límite de cobertura), redondea a 6 decimales (`round6`).
- `resolveDistanceKm(origin, buyer)`: `"lng,lat;lng,lat"` → `RoutingService.directions()`; `null` ante fallo.
- `resolveBuyerCoords(address, bias?)`: (1) coords del cliente siempre ganan (`source: 'client'`); (2) si no, `GeocodingService.forward(address_line1, city, state_province, { bias })` (`source: 'geocoded'`), solo si hay geocoder, `address_line1` y país vacío o `'CO'`; (3) `null` si nada resuelve.
- `resolveRatePrice(tiers, km)`: `{ price }` / `{ excluded: true }` / `null` (zona).

## Cotizador — `apps/backend/src/domains/store/shipping/shipping-calculator.service.ts` (NO bajo `services/`)

- `resolveQuoteDistances`: una llamada de ruteo por origen distinto. Sin origen → warn estructurado y zona. Sin coords del comprador → cada tarifa con distancia marcada `'buyer_geocode_failed'`.
- `applyDistancePrice`: precio del tramo; `'buyer_geocode_failed'` o `excluded` → `continue` en `calculateRates` (la tarifa no aparece, sin error).
- `quoteRateGross`: `null` cuando la tarifa no aparece (incluye sin coords del comprador); el llamador no debe inventar un costo.

## Confirmación — `CheckoutService.resolveConfirmShippingCost` (`apps/backend/src/domains/ecommerce/checkout/checkout.service.ts`)

Siempre recalcula (nunca confía en el costo del frontend). Llamado en checkout normal y WhatsApp (`wa_distanced`). Orden:
1. Tarifa `free` → 0 sin rutear.
2. Sin servicio o método sin `distance_pricing_enabled` → zona.
3. Escala corrupta/ausente → zona.
4. Sin origen → zona + warn `checkout.shipping_distance_unavailable` `reason: origin_coords_missing`.
5. Sin coords del comprador (snapshot vacío y `resolveBuyerCoords` null) → 400 `ECOM_CHECKOUT_003` (`reason: buyer_geocode_failed`): *"No pudimos ubicar la dirección de entrega. Marca la ubicación en el mapa para calcular el envío."* Si el geocode resuelve, escribir el punto en `address_snapshot.latitude/longitude`.
6. Ruteo lanza o null → zona + warn `routing_exception` / `routing_failed`.
7. Fuera de todos los tramos → 400 `ECOM_CHECKOUT_003` ("vuelve a cotizar el envío").

Tests: `apps/backend/src/domains/ecommerce/checkout/checkout-distance.spec.ts` (fija el `errorCode` exacto del rechazo estricto y de `buyer_geocode_failed`).

## `address_line1` en objetos de cotización

Sin él, `resolveBuyerCoords` no puede geocodificar. Ya lo incluyen: `payments.service.ts` (DTO de dirección), `orders.service.ts` (`shippingAddressForCalc` y cotización del checkout), `order-flow/order-flow.service.ts`. Todo caller nuevo debe incluirlo.

## Ruteo — `apps/backend/src/domains/ecommerce/routing/routing.service.ts`

- Primario Valhalla (`VALHALLA_BASE` = `valhalla1.openstreetmap.de`), costing `auto`, `VALHALLA_AUTO_COSTING_OPTIONS` vacío a propósito. Fallback OSRM (`router.project-osrm.org`), ruta primaria sin `alternatives=true`. Ambos son demos públicas sin SLA.
- Caché Redis 24 h, prefijo `routing:directions:v3:` (v3 = post-`shortest`); llave SHA-256 de coords normalizadas (`resolveLeg`, `normalizeCoords`). Single-flight (`acquireLock`). Multi-leg: cada par se cachea por separado.

## WhatsApp "envío por asignar" (regla 7)

- Contrato: checkout con `channel: 'whatsapp'` + `pending_shipping_assignment: true`, sin `shipping_method_id`/`shipping_rate_id`/`payment_method_id`. Orden `delivery_type='other'`, `shipping_method_id = NULL`, `shipping_cost = 0`, `state='pending_payment'`, sin `payments` ni factura automática; `orders.notes` lo explica.
- Guard `CheckoutService.assertPendingShippingAssignmentAllowed` (en `runCheckout`): canal whatsapp, sin método/tarifa, tienda con `ecommerce.checkout.whatsapp_checkout` + `whatsapp_number`; si no → 400 `ECOM_CHECKOUT_PENDING_SHIPPING_001`.
- `'other'` NO está en `SHIPPING_METHOD_EXEMPT_DELIVERY_TYPES`: cobrar (`ORD_SHIP_CHARGE_001`), despachar y remisionar (`ORD_SHIP_REQUIRED_001`, `dispatch-notes.service.ts createFromOrder` + pool) bloqueados hasta `assignShipping`. Con pagos, cambiar el costo → `ORD_SHIP_CHARGED_COST_CHANGE_001`.
- `apps/backend/src/jobs/payment-timeout-cleanup.job.ts` excluye `delivery_type='other' AND shipping_method_id IS NULL` del auto-cancel de 2 h.

## Frontend

- POS `pos-shipping-step.component.ts`: `hasResolvedLocation` exige coords antes de cotizar/cobrar; total "Pendiente"; `app-address-form-fields` con `[allowGeolocation]="false"`.
- Checkout `checkout.component.ts`: `hasResolvedCoords` → `shippingBlockedReason` → `canProceedFromAddressStep`. Saltar el gate no evita el 400 del backend.
- UX del mapa/pin/precisión: `vendix-address-geocoding`.
