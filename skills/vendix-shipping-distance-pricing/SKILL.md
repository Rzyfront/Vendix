---
name: vendix-shipping-distance-pricing
description: >
  Cobro de envío por distancia real (Valhalla/OSRM): tramos por km (`distance_tiers`), origen por método, `resolveBuyerCoords`, cobertura estricta en checkout. Trigger: tramos de distancia, `RoutingService`, `ECOM_CHECKOUT_003`, cobro por km impreciso.
license: MIT
metadata:
  author: rzyfront
  version: "1.2"
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

## Alcance

Solo el precio de envío por distancia real por calles: tramos por km, origen pineado por método, ruteo Valhalla/OSRM y cobertura al confirmar. El checkout general es de `vendix-ecommerce-checkout`; la captura de dirección y geocoding, de `vendix-address-geocoding`.

Detalle (archivos, orden de fallos, contrato WhatsApp, frontend): `references/architecture.md` (leer bajo demanda).

Código: `apps/backend/src/domains/store/shipping/services/shipping-distance.service.ts` (`toCoords`, `matchTier`, `parseTiers`, `resolveBuyerCoords`, `resolveRatePrice`), `apps/backend/src/domains/store/shipping/shipping-calculator.service.ts` (cotizador; NO está bajo `services/`), `CheckoutService.resolveConfirmShippingCost` en `apps/backend/src/domains/ecommerce/checkout/checkout.service.ts`, `apps/backend/src/domains/ecommerce/routing/routing.service.ts`.

## Reglas de negocio (Rafael, 2026-09-26/27)

1. **Rechazo estricto sin tolerancia.** Fuera de todos los tramos al confirmar → 400 `ECOM_CHECKOUT_003` con `matchTier` tal cual. No agregar "gracia" en el borde (se probó 0,2 km y se revirtió). Para cubrir más lejos: tramo abierto `to_km: null`.
2. **Consistencia cotización ↔ confirmación por normalización, no por tolerancia.** `ShippingDistanceService.toCoords` (6 decimales + corrección de swap) es el único normalizador, usado por cotizador y confirmación. Usar el mismo `resolveBuyerCoords` con el mismo `bias` en ambos.
3. **Degradar a zona solo por infraestructura** (método sin origen, ruteo caído/lanza, escala corrupta), siempre con `warn` estructurado (`store_id`, `shipping_method_id`, `reason`). Nunca en silencio: perder el log oculta cobros a zona.
4. **Nunca Haversine:** distancia por calles vía `RoutingService.directions()`.
5. **Ruta estándar, nunca `shortest: true`** (mandaba repartidores por trochas); OSRM sin `alternatives=true`.
6. **Sin coordenadas del comprador, sin tarifa.** Cotización: la tarifa con distancia se marca `'buyer_geocode_failed'` y se excluye. Confirmación: 400 `ECOM_CHECKOUT_003` "No pudimos ubicar la dirección de entrega. Marca la ubicación en el mapa para calcular el envío." No colapsar esta rama con las de infraestructura (regla 3). `resolveBuyerCoords` solo geocodifica Colombia y requiere `address_line1` en el objeto de dirección.
7. **WhatsApp "envío por asignar"** (geolocalización fallida + `whatsapp_checkout` activo con número): orden `delivery_type='other'`, sin método, costo 0, sin pago ni factura; guard servidor `assertPendingShippingAssignmentAllowed` (`ECOM_CHECKOUT_PENDING_SHIPPING_001`); cobrar/despachar/remisionar bloqueados hasta `assignShipping`. No relaja la regla 6.
8. Activar `distance_pricing_enabled` exige origen pineado (`assertDistanceOriginPinned`, 400).
9. El backend siempre recalcula el envío al confirmar; nunca confía en el costo del frontend.

## Decisión rápida

| Situación | Resultado |
| --- | --- |
| Dentro de un tramo | Precio del tramo |
| Fuera de tramos — cotización / confirmación | Tarifa excluida / 400 `ECOM_CHECKOUT_003` |
| Tarifa `free` | 0, sin rutear |
| Método sin `distance_pricing_enabled` | Zona |
| Sin coords del comprador — cotización / confirmación | Excluida / 400 `ECOM_CHECKOUT_003` |
| Sin origen, ruteo caído o escala corrupta | Zona + warn |

## Gotchas

- Rutear sin `toCoords` → llaves de caché distintas entre float de cotización y `Decimal(10,8)` persistido → puede cruzar un borde de tramo.
- Swap lat/lng pasa la validación de rango; solo el bbox de Colombia lo detecta (otro país sin bbox = solo validación de rango).
- Valhalla y OSRM son demos públicas sin SLA: el fail-open a zona es obligatorio.
- El 400 solo ocurre al confirmar; una tarifa cotizada puede rechazarse si la geometría cambió (trade-off aceptado).

Skills relacionados: `vendix-ecommerce-checkout`, `vendix-address-geocoding`, `vendix-error-handling`, `vendix-validation`.
