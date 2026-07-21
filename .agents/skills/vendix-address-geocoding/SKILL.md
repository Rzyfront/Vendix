---
name: vendix-address-geocoding
description: >
  Patrón unificado de direcciones + geocoding para checkout, clientes, remisiones y planilla.
  Cubre tabla `addresses`, endpoints `store/addresses`, snapshot `dispatch_notes.customer_address`,
  componente `app-address-map-picker` (MapLibre), `GeocodingService` frontend, proxy Nominatim backend,
  validación sintáctica + warning no-bloqueante, cascade `resolveStopCoordinates` y customer-modal
  crear-mode. Trigger: cuando editar/agregar dirección de cliente, remisión o stop; cuando el mapa
  del despacho rechaza una dirección; cuando integrar dirección + mapa opcional + geocoding.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
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
---

## Purpose

Gobierna el patrón unificado de direcciones físicas + geocoding que se repite en 4 módulos Vendix
(checkout, clientes, remisiones, planilla). Estandariza schema, endpoints, snapshot, componentes,
servicios, validación y cascade de coordenadas. No cubre direcciones de organización (solo shipping
address de customer/order/dispatch).

## When to Use

- Agregando/editando dirección de cliente (customer modal, checkout, admin).
- Editando snapshot `dispatch_notes.customer_address` o el endpoint `PATCH /store/dispatch-notes/:id/address`.
- Integrando `app-address-map-picker` (MapLibre) en un formulario Angular.
- Trabajando con `GeocodingService` frontend (`reverse`/`forward`).
- Editando proxy backend `ecommerce/geocoding` (Nominatim + Overpass + caché Redis).
- Debugueando stops `unlocated[]` del route-map o la cascade `resolveStopCoordinates`.
- Construyendo un customer-modal que captura dirección en crear-mode (sin `customer_id` todavía).
- Reutilizando `app-address-form-fields` (shared) en un nuevo formulario.

## Schema — tabla `addresses`

`schema.prisma` (~l.924-949):

| Campo | Tipo | Notas |
| --- | --- | --- |
| `address_line1` | String | Línea principal |
| `address_line2` | String? | Apartamento, suite, detalles |
| `city` | String | |
| `state_province` | String | Mapea desde DTO `state` |
| `country_code` | String | Mapea desde DTO `country` |
| `postal_code` | String? | |
| `municipality_code` | String? | |
| `phone_number` | String? | |
| `type` | `address_type_enum` @default(shipping) | |
| `is_primary` | Boolean @default(false) | Service unset otras al setear true |
| `latitude` | Decimal(10,8)? | Precisión GPS |
| `longitude` | Decimal(11,8)? | |
| `user_id` | String | Customer (users rol `customer`) |

Relación: `user_addresses` en `users`. Customer = `users` con rol `customer`.

## Backend Endpoints — `store/addresses`

`apps/backend/src/domains/store/addresses/`:

- `POST /` — create
- `GET /` — list own
- `GET /store/:storeId` — list by store
- `GET /:id` — get one
- `PATCH /:id` — update
- `DELETE /:id` — delete

Permisos: `store:addresses:create`, `store:addresses:read`, `store:addresses:update`, `store:addresses:delete`.

Service resuelve `customer_id → user_id` automáticamente. **Bloquea paso directo de `user_id` o
`organization_id` desde el cliente** (siempre derivar del customer). Maneja `is_primary`: al marcar
true, unset de las demás direcciones del mismo user.

## DTO Mismatch Crítico

`CreateAddressDto` (frontend→backend) usa claves cortas con guion bajo:

- `address_line_1`, `address_line_2`, `state`, `country`

Schema Prisma usa claves largas:

- `address_line1`, `address_line2`, `state_province`, `country_code`

El service mapea manualmente. **Mandar claves equivocadas (ej. `address_line1` o `state_province`
al backend) = datos descartados silenciosamente**. Siempre enviar las claves del DTO, no las del schema.

`landmark` y `delivery_instructions` existen en el DTO pero **NO son columnas** — se descartan al
persistir. Usarlos solo para display transient.

## Snapshot — `dispatch_notes.customer_address`

Columna Json? en `dispatch_notes`. Shape exacto con claves Prisma:

```json
{
  "address_line1": "...",
  "address_line2": "...",
  "city": "...",
  "state_province": "...",
  "country_code": "CO",
  "postal_code": "...",
  "phone_number": "...",
  "latitude": 4.710989,
  "longitude": -74.072090
}
```

Endpoint: `PATCH /store/dispatch-notes/:id/address` con DTO `UpdateDispatchNoteAddressDto`
(claves DTO: `address_line_1` etc.; service mapea a claves Prisma para el snapshot).

Service: `updateCustomerAddressSnapshot`.

**NO gatea status de la remisión** — es solo display + mapa, no afecta inventario ni contabilidad.

## Frontend — `app-address-map-picker`

`apps/frontend/src/app/private/modules/ecommerce/components/address-map-picker/`:

- Standalone, OnPush, **Zoneless** (ver `vendix-zoneless-signals`).
- Inputs: `center: input<LatLng|null>(null)`.
- Output: `located: output<LatLng>()`.
- `LatLng = { lat: number; lng: number }`.
- MapLibre dinámico, basemap **OpenFreeMap keyless**, marco Colombia, marker draggable.
- API pública (l.63-74): emite coords al mover marker.

Reutilizable: **solo emite coords**. No asume formulario, no persiste, no valida.

## Frontend — `GeocodingService`

`apps/frontend/src/app/private/modules/ecommerce/services/geocoding.service.ts`:

- `providedIn: 'root'`.
- `reverse(lat, lng): Observable<NormalizedAddress>` (l.56).
- `forward(query): Observable<ForwardGeocodeResult>` (l.83).
- Header `x-store-id` en cada request.
- Llama al proxy backend (no a Nominatim directo).

## Backend — Proxy Nominatim

`apps/backend/src/domains/ecommerce/geocoding/`:

- `GET /ecommerce/geocoding/reverse?lat=&lng=` → `NormalizedAddress`.
- `GET /ecommerce/geocoding/forward?q=` → `ForwardGeocodeResult`. **`@OptionalAuth`, público** (lo usa
  el checkout sin sesión, ej. guest).
- Caché Redis: **30 días reverse / 7 días forward**. **Null se cachea 7 días** — reintentar
  inmediatamente no mejora (rurales / direcciones nuevas siguen sin resolverse).
- Single-flight lock (evita thundering herd en geocoding concurrente).
- Enriquecimiento cross-street vía Overpass (nombres de calles transversales).

## Patrón de Validación

Sintáctica **bloqueante** + geocoding **warning no-bloqueante**. Referencia:
`checkout.component.ts:419-446`.

```typescript
// Bloqueantes
Validators.required,
Validators.minLength(N),
Validators.maxLength(N),
Validators.pattern(/.../)
```

Si `forward(query)` retorna `null` → setear signal `addressWarning` con mensaje, **NO bloquear el
submit**. Nominatim falla en rurales y direcciones nuevas; bloquear rompe el alta de clientes.

```typescript
readonly addressWarning = signal<string | null>(null);
// ...
this.geocoding.forward(query).subscribe(r => {
  if (!r) this.addressWarning.set('No pudimos ubicar la dirección en el mapa');
});
```

## Shared — `app-address-form-fields`

`apps/frontend/src/app/shared/components/address-form-fields/`:

- Inputs: `initialAddress`, `center`.
- Outputs: `addressChange`, `validChange`.
- Signals: `showMap`, `addressWarning`, `coordsSignal`.
- Reutilizable en **customer-modal** y **dispatch-note-address-editor** (mismo componente, dos
  consumidores).

## Cascade — `resolveStopCoordinates`

`apps/backend/src/domains/store/dispatch-routes/dispatch-routes.service.ts` (~l.1393-1438):

Orden de resolución para un stop:

1. `dispatch_note.customer_address` JSON lat/lng (snapshot).
2. `order.shipping_address_snapshot`.
3. `order.addresses` fila.
4. Customer shipping address (última known).
5. `forward`-geocode Nominatim (caché 7d).

Si todo falla → stop se agrega a `unlocated[]`.

**Re-snapshot con coords correctas arregla el mapa automáticamente** — el paso (a) gana. Editar la
dirección del dispatch-note actualiza el snapshot y el route-map lo levanta al refrescar.

`unlocated[]` ahora emite `dispatchNoteId` + `customerAddress` para que el botón **"Fijar en mapa"**
del `route-map-view` abra el editor de dirección sobre ese stop específico.

## Patrón — Customer Modal Crear-Mode

El modal de alta de customer **NO puede persistir dirección solo** — `POST /store/addresses` exige
`customer_id`, que existe solo tras `createCustomer` en el padre.

Solución:

1. Modal emite output `addressData` (no llama al service).
2. Padre captura en signal `pendingAddress`.
3. Tras `createCustomer` retornar el user_id, padre persiste con `POST /store/addresses`.

Edit-mode sí persiste el modal directamente (el customer ya existe).

## Referencias de Implementación

- `apps/frontend/src/app/private/modules/ecommerce/checkout/checkout.component.ts:303,533,735` — integración checkout.
- `apps/frontend/src/app/private/modules/ecommerce/services/store-orders.service.ts:619-660` — `createCustomerAddress` / `updateOrderShippingAddress`.
- `apps/frontend/src/app/private/modules/ecommerce/components/address-map-picker/address-map-picker.component.ts:63-74` — API pública.
- `apps/frontend/src/app/private/modules/ecommerce/services/geocoding.service.ts:56,83` — `reverse` / `forward`.

## Rules

- Mandar claves DTO (`address_line_1`, `state`, `country`) al backend, **NO** claves Prisma.
- No bloquear submit por fallos de geocoding — solo warning.
- En crear-mode customer-modal, emitir `addressData`; persistir en el padre tras `createCustomer`.
- Snapshot `dispatch_notes.customer_address` usa claves **Prisma** (no DTO).
- `PATCH /store/dispatch-notes/:id/address` no gatea status — display + mapa.
- Re-snapshotear coords correctas arregla el route-map (paso (a) gana).
- Usar `app-address-map-picker` solo para emitir coords; no acoplar a formularios.
- No mandar `user_id`/`organization_id` desde el cliente en `POST /store/addresses` — el service
  deriva `customer_id → user_id`.

## Gotchas

- **swc --watch stale (VirtioFS)**: agregar un endpoint nuevo al backend requiere `docker restart`
  del container — el watch no lo levanta aunque recompiles. Ver `reference_backend_swc_watch_stale`.
- **Caché Nominatim 7d para null**: reintentar geocoding inmediatamente no mejora el resultado. Si la
  dirección es nueva o rural, el cacheo de null evita spammer Nominatim (rate-limit público).
- **No `git add -A` en árbol compartido** — tocar solo archivos de este skill al commitear.

## Related Skills

- `vendix-frontend-component` — standalone components
- `vendix-zoneless-signals` — **CRÍTICO** en frontend (signals, OnPush, `input`/`output`)
- `vendix-angular-forms` — Validators, FormGroup
- `vendix-frontend-modal` — modales
- `vendix-validation` — patrón validación bloqueante + warning
- `vendix-customer-auth` — customer / users rol `customer`
- `vendix-dispatch-routes` — cascade `resolveStopCoordinates`, `unlocated[]`
- `vendix-backend-api` — endpoints `store/addresses`, `ecommerce/geocoding`
- `vendix-permissions` — `store:addresses:*`
- `vendix-naming-conventions` — claves DTO vs Prisma