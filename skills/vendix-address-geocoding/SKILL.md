---
name: vendix-address-geocoding
description: >
  Direcciones + geocoding: tabla addresses, app-address-map-picker (MapLibre), GeocodingService,
  parser de nomenclatura colombiana, cascade de precisión y fallback Google. Trigger: dirección de
  cliente/remisión/stop, mapa de despacho, geocoding.
license: MIT
metadata:
  author: rzyfront
  version: "1.3"
  scope: [root]
  auto_invoke:
    - "Adding or editing a customer shipping address"
    - "Editing dispatch_note customer_address snapshot or PATCH /store/dispatch-notes/:id/address"
    - "Integrating app-address-map-picker (MapLibre) into a form"
    - "Working with GeocodingService (reverse/forward) frontend"
    - "Editing backend ecommerce/geocoding proxy (Nominatim/Overpass)"
    - "Debugging route-map unlocated stops or resolveStopCoordinates cascade"
    - "Building a customer-modal that captures address in crear-mode"
    - "Reusing app-address-form-fields shared component"
    - "Parsing or normalizing Colombian address nomenclature"
    - "Configuring the Google Geocoding fallback or its monthly cap"
    - "Debugging why a forward-geocode resolves with low precision (street/area) instead of intersection/exact"
---

## Alcance

Direcciones de envío de customer/order/dispatch (no direcciones de organización): tabla `addresses`, `store/addresses`, snapshot `dispatch_notes.customer_address`, `app-address-map-picker`, `app-address-form-fields`, `GeocodingService` frontend/backend, parser colombiano, cascade de precisión, fallback Google y `resolveStopCoordinates`.

Detalle backend (parser, cascade, compuerta de esquina, Google, caché): `references/forward-cascade.md` (leer bajo demanda).
Detalle frontend (gate por consumidor, WhatsApp, auto-foco, DANE, GPS): `references/frontend-ux.md` (leer bajo demanda).

## Mapa de código

- Backend direcciones: `apps/backend/src/domains/store/addresses/` (CRUD + `dian/departments`, `dian/municipalities`, `dian/municipalities/resolve`). Permisos `store:addresses:{create,read,update,delete}`.
- Backend geocoding: `apps/backend/src/domains/ecommerce/geocoding/` (`geocoding.service.ts`, `colombian-address.util.ts`, `google-geocoding.provider.ts`). Endpoints `@OptionalAuth`: `reverse`, `forward`, `municipality-center`.
- Snapshot remisión: `PATCH /store/dispatch-notes/:id/address` (`UpdateDispatchNoteAddressDto`, `updateCustomerAddressSnapshot` en `dispatch-notes.service.ts`).
- Stops: `resolveStopCoordinates` en `apps/backend/src/domains/store/dispatch-routes/dispatch-routes.service.ts`.
- Frontend: `private/modules/ecommerce/components/address-map-picker/`, `private/modules/ecommerce/services/geocoding.service.ts`, `shared/components/address-form-fields/`, `private/modules/ecommerce/pages/checkout/checkout.component.ts`, `private/modules/store/pos/components/pos-checkout-shell/steps/pos-shipping-step.component.ts`, `private/modules/store/orders/services/store-orders.service.ts` (`createCustomerAddress`, `updateOrderShippingAddress`).

## Reglas

1. **DTO ≠ Prisma.** Al backend se mandan claves DTO `address_line_1`, `address_line_2`, `state`, `country`; el service mapea a `address_line1`, `address_line2`, `state_province`, `country_code`. Claves equivocadas = datos descartados en silencio. `landmark`/`delivery_instructions` no son columnas (solo display).
2. **Snapshot `dispatch_notes.customer_address` usa claves Prisma** (`address_line1`, `city`, `state_province`, `country_code`, `postal_code`, `phone_number`, `latitude`, `longitude`). El PATCH de dirección no gatea status: es display + mapa, no toca inventario ni contabilidad.
3. **Nunca mandar `user_id`/`organization_id`** desde el cliente en `POST /store/addresses`; el service deriva `customer_id → user_id`. `is_primary = true` desmarca las demás del mismo user.
4. **Customer-modal crear-mode:** el modal emite `addressData`, el padre lo guarda en `pendingAddress` y persiste tras `createCustomer`. En edit-mode el modal persiste directo.
5. **El mapa solo emite coordenadas.** Nunca prefillear/sobrescribir texto de dirección ni `city`/`state_province`/`municipality_code` desde geocoding o GPS (`prefillFromGeocode` fue removido a propósito). `pinConfirmed` bloquea que un forward posterior pise el pin; se resetea al cambiar `address_line1`.
6. **Bloqueo por coordenadas:** no-bloqueante (solo warning) en customer-modal y editor de remisión; **bloqueante** en envío a domicilio (checkout y POS). El gate lo pone el consumidor, nunca `app-address-form-fields`. Regla "sin coordenadas, sin tarifa": `vendix-shipping-distance-pricing`.
7. **Geografía DANE:** Departamento → Ciudad con códigos DANE, sin texto libre; si no hidrata, dejar vacío e inválido, nunca inventar.
8. **`municipality-center` es solo encuadre visual**: nunca pin, coordenada de entrega ni cotización.
9. **Compuerta de esquina:** una esquina Overpass única se valida contra un ancla ≤ 2 km o se descarta; no quitarla ni aplicarla a multi-candidato.
10. **Caché forward:** al cambiar materialmente la cascade o la clasificación, subir `geocode:fwd:vN:` (hoy v6). Nunca `FLUSHALL` en Redis de prod. `bias` entra a la llave solo sin `city`/`municipality_code` (a propósito, no es bug).
11. **Google:** fail-open total, INCR antes de llamar, nunca loguear `GOOGLE_GEOCODING_API_KEY`; inyectar key y tope en cada bloque `docker run` del deploy.
12. **`resolveStopCoordinates`:** snapshot de la remisión → `order.shipping_address_snapshot` → fila `order.addresses` → última dirección del customer → forward (caché). Si falla, `unlocated[]` con `dispatchNoteId` + `customerAddress` para "Fijar en mapa". Re-snapshotear coords correctas arregla el mapa.

## Gotchas

- swc --watch no levanta endpoints nuevos en Docker (VirtioFS): `docker restart vendix_backend`.
- Caché 7 d éxito / 6 h null: reintentar enseguida no mejora el resultado.
- Fallback Google ausente en un entorno = solo un warn `google_no_key`; no hay error visible.

## Skills relacionados

`vendix-zoneless-signals`, `vendix-angular-forms`, `vendix-frontend-modal`, `vendix-dispatch-routes`, `vendix-shipping-distance-pricing`, `vendix-redis-quota`, `vendix-permissions`, `vendix-naming-conventions`.
