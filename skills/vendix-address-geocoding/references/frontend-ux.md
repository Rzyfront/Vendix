# Frontend de direcciones: validación, mapa, auto-foco, DANE

## Gate por consumidor (regla de negocio owner 2026-09-27)

Sintaxis siempre bloqueante (validators required/min/max/pattern; referencia en `checkout.component.ts`). Falta de coordenada resuelta:

| Consumidor | Sin coord resuelta |
| --- | --- |
| `customer-modal`, `dispatch-note-address-editor` (vía `app-address-form-fields`) | NO bloquea: solo `addressWarning`; `validChange` depende solo de validators sintácticos |
| Checkout ecommerce, entrega a domicilio (`checkout.component.ts`) | BLOQUEA Continuar: `hasResolvedCoords()` / `shippingBlockedReason()` / `canProceedFromAddressStep()`. Pickup y carritos solo-servicio nunca se gatean |
| POS envío a domicilio (`pos-shipping-step.component.ts`) | BLOQUEA cobrar/guardar: `hasResolvedLocation()`; total "Pendiente" mientras no resuelve |

`app-address-form-fields` siempre es no-bloqueante; el gate lo añade el consumidor leyendo `has_location`/coords de `addressChange`.

## Salida por WhatsApp (checkout)

- Disparo: "Usar mi ubicación automática" con geolocalización `denied`/no soportada/fallida (`onLocateRequested` + catch de `requestGeolocation`). Un forward fallido NO dispara el modal.
- Gate: `canUseWhatsappFallback` = `ecommerce.checkout.whatsapp_checkout === true` + `whatsapp_number` no vacío; si no, toast "marca tu ubicación en el mapa".
- UX: `app-whatsapp-fallback-modal` (`private/modules/ecommerce/components/whatsapp-fallback-modal/`): `isOpen` model, `loading`, `confirm` (no cierra) / `decline` (cierra y enfoca mapa). Los márgenes negativos del hero deben igualar el padding de `app-modal` (`px-3 py-2.5` / `md:px-5 md:py-4`) o aparece scroll horizontal.
- Envío: valida dirección, pide datos de invitado si faltan, manda `pending_shipping_assignment: true` sin coords y abre `wa.me` con "Envío: por definir con la tienda" y "Total (sin envío)". Contrato backend en `vendix-shipping-distance-pricing`.

## Auto-foco del mapa (form-fields y checkout)

1. `forwardGeocodeFromForm` no corre (y limpia aviso/precisión) hasta tener país + depto + ciudad + `address_line1` (≥5).
2. Auto-foco solo con depto + ciudad + línea; debounce 500 ms (`requestAutoMapFocus`) cancelado por cualquier cambio de campo.
3. Si el foco está en un input/textarea/select del host, esperar un `blur` de un solo uso y re-evaluar en `setTimeout(0)`.
4. Una sola vez (`autoMapFocusDone`).
5. Abrir mapa (`showMap`/`advancedOverride`) y el aviso (`pendingAddressWarning`) se retienen hasta el disparo (en POS el mapa va encima de los campos).
6. Acciones del usuario siempre hacen scroll (`focusMapHint('user')`) y vacían el aviso pendiente.
7. `mapHighlight` puede correr siempre.
Timers/listeners como campos privados (no signals) con limpieza en `DestroyRef.onDestroy`.

## `app-address-form-fields` (`apps/frontend/src/app/shared/components/address-form-fields/`)

- Inputs: `initialAddress`, `center`, `compact`, `dianEndpointBase`, `requirePhone`, `showPhone`, `showErrors`, `allowGeolocation` (default true; POS pasa `false`: el dispositivo del cajero está en la tienda).
- Outputs: `addressChange` (valor + `pin_confirmed`, `geocode_precision`, `has_location`), `validChange`.
- Signals: `showMap`, `addressWarning`, `coordsSignal`, `precision`, `geocodeLabel`, `mapHighlight`, `pinConfirmed`.
- `onLocated(coords)` solo fija lat/lng + `pinConfirmed = true`. Mientras `pinConfirmed`, el forward no sobrescribe la coordenada; se resetea al cambiar `address_line1`.
- `precisionBadge`: pin confirmado gana ("Punto confirmado en el mapa").
- Consumidores: customer-modal, dispatch-note-address-editor, POS shipping step. El checkout ecommerce NO lo usa: monta `app-address-map-picker` directo (`onMapLocated`) con su propia lógica de bloqueo.

## Geografía DANE (solo Colombia)

- Departamento (código DANE 2 dígitos) → Ciudad (municipio 5 dígitos, deshabilitada hasta elegir depto) con `app-selector` buscables. Sin tercer selector ni texto libre.
- Guarda nombres oficiales en `city`/`state_province` y el código en `municipality_code` (requerido en el form; opcional en `AddressPayload` legado).
- Endpoints: `GET /store/addresses/dian/departments`, `/store/addresses/dian/municipalities?department_code=NN`, `/store/addresses/dian/municipalities/resolve`. `DianMunicipalityLookupService.listDepartments()` / `listByDepartment(code)` cachean y traen el depto completo sin paginar.
- Al editar: hidratar por `resolveByCode(municipality_code)`, si no `resolveByName(city, state_province)`. Sin coincidencia: selectores vacíos, pista con valores previos, form inválido hasta elección explícita. Nunca inventar selección.
- El geocoding nunca sobrescribe city/state_province/código.

## GPS y mapa (`app-address-map-picker`)

- Standalone, OnPush, zoneless; `center: input<LatLng|null>`, `located: output<LatLng>`; MapLibre dinámico, basemap OpenFreeMap keyless, marco Colombia, marker draggable.
- Controles Navigation → Fullscreen → GPS. "Usar mi ubicación actual" pide permiso solo tras clic (nunca al montar). En POS se habilita para preventistas a domicilio. Solo actualiza lat/lng y confirma pin. Permiso denegado → captura manual.
- Sin botón de recentrado (retirado por el owner). `center=null` → quitar marcador y limpiar `hasPoint`, incluso durante carga asíncrona.
- Encuadre por municipio: usar `municipality-center` solo como vista.
