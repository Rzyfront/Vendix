---
name: vendix-address-geocoding
description: >
  Patrón unificado de direcciones + geocoding para checkout, clientes, remisiones y planilla.
  Cubre tabla `addresses`, endpoints `store/addresses`, snapshot `dispatch_notes.customer_address`,
  componente `app-address-map-picker` (MapLibre), `GeocodingService` frontend/backend, el parser de
  nomenclatura colombiana (`colombian-address.util.ts`), la cascade de forward-geocoding con
  precisión graduada (`exact`/`interpolated`/`intersection`/`street`/`area`) y su fallback pago a
  Google, validación sintáctica + warning no-bloqueante (bloqueante solo para envío a domicilio),
  cascade `resolveStopCoordinates` y customer-modal crear-mode. Trigger: cuando editar/agregar
  dirección de cliente, remisión o stop; cuando el mapa del despacho rechaza una dirección; cuando
  integrar dirección + mapa opcional + geocoding; cuando parsear nomenclatura colombiana o depurar
  el fallback de Google.
license: MIT
metadata:
  author: rzyfront
  version: "1.2"
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
- Parseando/normalizando nomenclatura colombiana (CL/Cll, KR/Cra, DG, TV, AV, AUTO, CIR/CQ,
  intersecciones "con", rangos de placa, Km rural, nombres históricos entre paréntesis).
- Depurando por qué una dirección resuelve con precisión `street`/`area` en vez de
  `intersection`/`exact`, o configurando el fallback de Google Geocoding y su tope mensual.

## Schema — tabla `addresses`

`schema.prisma:1190-1216`:

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
- `reverse(lat, lng): Observable<NormalizedAddress>` (l.68).
- `forward(query, opts?: { city?, state? }): Observable<ForwardGeocodeResult>` (l.102). El frontend
  **NO** expone `municipalityCode`/`bias` (eso lo resuelve el backend solo, ver Cascade abajo) —
  solo puede adelantar `city`/`state` cuando ya los conoce (p.ej. un dropdown de departamento ya
  seleccionado), para saltarse el parseo por comas de `parseFreeTextQuery` en el backend.
- `ForwardGeocodeResult` trae `lat`, `lng`, `precision?: GeocodePrecision`, `source?: 'osm'|'google'`,
  `label?: string` — ver **Precision Contract** abajo. Header `x-store-id` en cada request.
- Llama al proxy backend (no a Nominatim ni a Google directo).

## Precision Contract — `GeocodePrecision`

Tipo compartido (idéntico en backend `geocoding.service.ts:56-61` y frontend
`geocoding.service.ts:28-33`):

```typescript
type GeocodePrecision = 'exact' | 'interpolated' | 'intersection' | 'street' | 'area';
```

Orden de precisión decreciente — usado por el ranking del cascade (`precisionRank`,
`geocoding.service.ts:477-492`) y por el badge del frontend:

| Precisión | Significado |
| --- | --- |
| `exact` | Match con `house_number` verificado (placa exacta) |
| `interpolated` | Punto caminado `placa` metros desde la esquina DANE, o `RANGE_INTERPOLATED` de Google |
| `intersection` | Esquina DANE (vía × vía generadora) vía Overpass |
| `street` | Calle nombrada, sin número de casa específico |
| `area` | Centroide de barrio/vereda/finca — último recurso |

`ForwardGeocodeResult` (backend `geocoding.service.ts:36-54`, frontend `geocoding.service.ts:35-43`)
agrega, además de `lat`/`lng`:

- `source?: 'osm' | 'google'` — proveedor que ganó la coordenada. Ausente = `'osm'` (default).
- `label?: string` — dirección canónica legible a la que pertenece la coordenada (solo display).

Firma completa del backend (`geocoding.service.ts:283-288`):

```typescript
forward(
  query: string,
  city?: string,
  state?: string,
  opts?: { municipalityCode?: string; bias?: { lat: number; lng: number } },
): Promise<ForwardGeocodeResult>
```

`municipalityCode` (código DANE de 5 dígitos) pinea el bbox del municipio exacto, saltándose la
ambigüedad de nombre de ciudad. `bias` es un punto de respaldo (típicamente el origen del método de
envío) usado SOLO cuando no hay `city` para acotar candidatos.

## Parser Colombiano — `colombian-address.util.ts`

`apps/backend/src/domains/ecommerce/geocoding/colombian-address.util.ts`. Puro, sin red/Redis/DI —
testeable en aislado (`colombian-address.util.spec.ts`). Exporta `normalizeColombianAddress(input)`
→ `ParsedColombianAddress` con `kind: 'dane' | 'interseccion' | 'manzana' | 'rural' | 'libre'`.

- **Abreviaturas de tipo de vía** reconocidas (`VIA_TIPO_TABLE`, l.106-141), longest-match primero:
  `Calle`/`Cll`/`Cl`, `Carrera`/`Kra`/`Cra`/`Kr`/`Cr`, `Diagonal`/`Diag`/`Dg`, `Transversal`/`Transv`/
  `Tv`/`Tr`, `Avenida`/`Av`/`Avda`, `Avenida Calle`/`AC`, `Avenida Carrera`/`AK`, `Autopista`/`Aut`,
  `Circular`/`Cir`/`CQ`, `Circunvalar`/`CV`, `Vía`.
- **Letra/bis/cuadrante**: `parseViaNumberTokens` (l.219-250) separa número, letra ("45A" → "45 A"
  vía `splitAttachedLetter`, l.207-209), "Bis" y cuadrante (`sur`/`norte`/`este`/`oeste`).
- **Intersecciones "con"/"y"**: `CON_Y_RE` (l.149) + rama `(2)` de `parseMainSegment` (l.486-542) —
  arma `viaTipo`/`viaNum` + `cruceTipo`/`cruceNum`, marcando `kind: 'interseccion'`.
- **Rangos de placa**: `AL_RANGE_RE` ("13-02 al 13-20", l.152) → `placaRangoFin`.
- **Km rural**: `Km <n> Vía <destino>` (`tryExtractAreaSegment`, l.372) → `rural.km`/`rural.via`,
  `kind: 'rural'`.
- **Nombres históricos entre paréntesis**: `"Avenida del Ferrocarril (Carrera 15) # 22-04"` — el
  paréntesis gana como vía real y el texto previo se guarda en `legacyName` (l.615-621).
- **Complementos despojados**: `torre`/`apto`/`interior`/`casa`/`oficina`/`local`/`bodega`/
  `modulo`/`piso`/`manzana`/`lote`/`bloque`/`etapa` (`COMPLEMENT_RE`, l.188-189, con `\b` obligatorio
  para no romper "Torres"/"Casablanca"/"Interamericana"). `vereda`/`corregimiento`/`sector`/`finca`
  se extraen aparte como segmentos rurales/de área (`tryExtractAreaSegment`, l.342-375), no como
  complemento.
- `selectBestCandidate` (l.931-980): clasifica un resultado Nominatim en `exact`/`street`/`area`
  (descarta `admin` — match de solo ciudad/departamento/país) y desempata por match de ciudad y
  luego por `importance`.

## Cascade — Forward-Geocoding (`GeocodingService.forward`)

`apps/backend/src/domains/ecommerce/geocoding/geocoding.service.ts:283-467`. Nunca lanza: una
cascade agotada degrada a `{ lat: null, lng: null }`.

Orden de intentos (se detiene en el primer resultado con precisión ≥ `intersection`, l.438-444):

1. **Bbox del municipio** (`resolveMunicipalityBbox`, l.496-516) — Nominatim `boundingbox`
   (caché Redis 30 días) con fallback Overpass por nombre administrativo (caché 24h si no resuelve,
   para que un nombre mal tecleado se autocorrija pronto). Sin `city`, se usa un bbox de ~25 km
   alrededor de `opts.bias` (`BIAS_BBOX_RADIUS_KM`, l.224).
2. **Intersección DANE vía Overpass + interpolación de placa** (`tryIntersection`,
   l.753-859): busca la calle transversal dentro del bbox, luego la vía principal `around` esa
   transversal (40 m) — más barato y más preciso que buscar ambas en toda la ciudad. Si la placa
   existe y es ≤ **150 m** (`MAX_INTERPOLATION_METERS`, l.206), camina esa distancia sobre la vía
   principal desde la esquina (`walkAlongWayFromPoint`) y sube la precisión a `interpolated`; si no,
   se queda en `intersection`. `selectBestCorner` (l.1238-1286) desambigua cuando Overpass regresa
   más de una esquina (p.ej. la colisión medida Bogotá/Soacha "Calle 32 × Carrera 7", donde el bbox
   rectangular de un municipio puede cubrir parte del vecino): prefiere la esquina más cercana a
   `bias`, luego al centro del bbox, luego la más cercana entre sí — un **desempate de cercanía**,
   NO un rechazo duro por distancia (ver Gotcha abajo).
   - **Mirrors Overpass** (`OVERPASS_MIRRORS`, l.216-220): `overpass.openstreetmap.fr` (primero,
     más rápido/consistente), `overpass-api.de` (intermitente 406/504), `maps.mail.ru` (lento pero
     usable) — corridos en paralelo (`raceOverpassMirrors`), gana el primero que responda.
   - Timeout de intersección: **8000 ms** (`INTERSECTION_TIMEOUT_MS`, l.202 — medido en vivo
     2026-09-27: `fr` responde en 1-4s, `de` es intermitente, `mail.ru` lento pero usable; 2.5s
     cortaba `fr` antes de terminar).
3. **Nominatim structured search** (`tryStructuredSearch`, l.939-995): `street="<placa> <viaTipo>
   <viaNum>"` acotado al bbox (`viewbox`+`bounded=1`).
4. **Nominatim free-text** (`tryFreeText`, l.997-1052): último recurso OSM, con un reintento sin
   bbox si el filtro geográfico eliminó todos los candidatos.
5. **Fallback Google** (`tryGoogleFallback`, l.1096-1123) — ver sección propia abajo. Se intenta
   SOLO si el mejor resultado OSM es `null`/`street`/`area`, y gana solo si aterriza dentro del bbox
   con precisión **ESTRICTAMENTE mejor** que la ya obtenida.

**Presupuestos duros** (evitan tormentas de tráfico y cuelgues):

- **`MAX_FORWARD_EXTERNAL_REQUESTS = 5`** (l.194) — tope de llamadas externas (Nominatim + Overpass)
  por `forward()`, para respetar la política ~1 req/s de Nominatim.
- **`FORWARD_OVERALL_BUDGET_MS = 15000`** (l.232) — reloj de pared total de un `forward()`, contado
  desde que arranca la cascade (incluye resolución del bbox); al superarse, la cascade deja de
  avanzar con lo que ya tenga.

**Rural/manzana** (`tryRural`/`tryAreaName`, l.637-749): kind `rural` busca primero un punto sobre
la vía (`tryRoadPoint`, camina metros desde el Km) y si no, el nombre de vereda/corregimiento/sector/
finca como área (`precision: 'area'`); kind `manzana` busca directamente el nombre de la
urbanización/barrio/conjunto.

### Plausibilidad de la esquina — compuerta dura (2026-09-27)

**Regla:** una esquina de Overpass solo se acepta si es corroborable. `selectBestCorner` devuelve
también `candidateCount`:

- **Varias candidatas** dentro del bbox → el desempate por cercanía a `bias`/centro-de-bbox ya se
  autocorrobora (una esquina urbana real produce muchos fragmentos de vía agrupados); se acepta.
- **Una sola candidata** → se contrasta contra un ancla independiente
  (`resolveIntersectionAnchor`): primero Nominatim estructurado de la MISMA dirección con placa
  (`"<cruce>-<placa> <vía>"`, nunca el nombre de calle pelado — "Carrera 13" sola mide km y
  rechazaba esquinas buenas), si no el centroide de la vía principal. Si la esquina queda a más de
  `INTERSECTION_ANCHOR_MAX_METERS = 2000` m del ancla, o no hay ancla, se **descarta** (warn
  `Intersection corner rejected`) y la cascade cae a la precisión honesta de Nominatim
  (`street`/`area`).

Caso que la motivó: "Calle 14 # 26-13, Bogotá" daba un único par "Calle 14"/"Carrera 26" en un
corregimiento rural a ~15 km (el bbox administrativo de Bogotá D.C. incluye zona rural), reportado
como `interpolated`. Tras la compuerta resuelve en zona urbana con `street`. NO aplicar la
compuerta a resultados multi-candidato: Nominatim es un ancla poco fiable para calles largas de
Bogotá (a 5,6 km de una esquina correcta en vivo) y producía rechazos falsos.

**Limitación conocida:** el sentido de la interpolación de placa sigue el orden de vértices de la
vía OSM, que no garantiza el sentido creciente de la numeración (Cra 13 # 62-40 queda a ~99 m).
Sin nodos `addr:housenumber` en OSM no hay señal barata para calibrarlo.

## Fallback Google — `google-geocoding.provider.ts`

`apps/backend/src/domains/ecommerce/geocoding/google-geocoding.provider.ts`. Usado SOLO cuando la
cascade OSM resuelve a `null`/`street`/`area` (ver paso 5 arriba).

- **Gate por env var**: `GOOGLE_GEOCODING_API_KEY` ausente ⇒ feature deshabilitada por completo,
  free tier se queda 100% OSM (`geocode()` retorna `null` inmediatamente, l.75-81, con un warn
  logueado UNA sola vez por proceso — nunca imprime la key).
- **Tope mensual Redis**: `GOOGLE_GEOCODING_MONTHLY_CAP` (default **5000**, `monthlyCap` getter,
  l.58-61) vía `checkAndIncrementCap` (l.197-209) — llave `geocode:google:YYYYMM` (período UTC),
  patrón **INCR + EXPIRE** (ver `vendix-redis-quota`), TTL 35 días. **INCR-antes-de-llamar**: cuenta
  llamadas INTENTADAS (Google cobra por request sin importar el resultado), a propósito distinto del
  patrón "consumir tras éxito" de cuotas de features IA.
- **Fail-open total**: CUALQUIER falla (sin key, tope alcanzado, red, timeout 4000ms,
  `ZERO_RESULTS`, `OVER_QUERY_LIMIT`, `REQUEST_DENIED`, JSON malformado, respuesta sin
  `geometry.location`) resuelve a `null` — el llamador simplemente se queda con su resolución OSM
  propia, NUNCA rompe ni bloquea el forward-geocode (l.35-40 doc de clase).
- **Nunca loguea la key** — todos los warns usan `JSON.stringify({ reason: '...' })` sin
  interpolar `apiKey`/`params` completos.
- **Mapeo de precisión** (`mapPrecision`, l.175-192): `ROOFTOP` → `exact`, `RANGE_INTERPOLATED` →
  `interpolated`, `GEOMETRIC_CENTER` → `intersection` (si `types` incluye `intersection`) / `street`
  (si incluye `route`) / `area`, `APPROXIMATE` → `area`.
- **Prod**: la key y el tope viven en Secrets Manager `vendix/production/app` (junto a
  `DATABASE_URL`, `JWT_SECRET`, etc. — otros secrets separados). `.github/workflows/deploy-backend-ec2.yml`
  los extrae del secreto (l.138-139) y los inyecta como `-e GOOGLE_GEOCODING_API_KEY=...` /
  `-e GOOGLE_GEOCODING_MONTHLY_CAP=...` en AMBOS bloques `docker run` (deploy normal l.244-245,
  deploy de rollback/recovery l.322-323) — si se agrega un tercer bloque `docker run` del backend,
  debe repetirse ahí también o el proceso arranca sin la env var (fail-open silencioso: simplemente
  nunca usa Google).

## Backend — Proxy Nominatim

`apps/backend/src/domains/ecommerce/geocoding/`:

- `GET /ecommerce/geocoding/reverse?lat=&lng=` → `NormalizedAddress`.
- `GET /ecommerce/geocoding/forward?q=&city=&state=&municipality_code=` → `ForwardGeocodeResult`.
  **`@OptionalAuth`, público** (lo usa el checkout sin sesión, ej. guest). Cuando NO se manda `city`
  y SÍ llega el header `x-store-id`, el controller resuelve un `bias` best-effort desde el primer
  `shipping_methods` activo de esa tienda con origen pineado (`resolveShippingOriginBias`,
  `geocoding.controller.ts:135-160`) — bajo un `RequestContextService.runIsolated` que nunca toca el
  contexto de auth real de la petición; cualquier fallo (header inválido, tienda inexistente, sin
  método con coords) se ignora en silencio y el endpoint sigue siendo público.
- Caché Redis reverse: **30 días** (`geocode:rev:*`).
- Caché Redis forward: **versionada** `geocode:fwd:vN:` (hoy **v5** — v4→v5 al añadir la compuerta de plausibilidad, `buildForwardCacheKey`,
  `geocoding.service.ts:335-361`) sobre la línea normalizada + `city` + `state` +
  `municipality_code` — **7 días éxito / 6 horas null** (`FORWARD_NULL_CACHE_TTL_SECONDS`, l.183;
  bajado de la ventana anterior para que una dirección nueva/rural se reintente antes). `bias` SOLO
  entra a la llave cuando NO hay `city` ni `municipality_code` (`hasLocationContext`, l.348-353) —
  así la cotización (bias = origen del primer método candidato) y la confirmación (bias = origen
  del método ELEGIDO) de la MISMA dirección+ciudad leen la MISMA llave, sin medir desde puntos
  distintos (ver `vendix-shipping-distance-pricing` regla 2). Cuando sí entra, se redondea a 2
  decimales (~1.1 km) para que biases cercanos compartan cascade.
  - **Bump de versión, NUNCA `FLUSHALL`**: cuando la forma de la cascade cambia materialmente (p.ej.
    v3→v4 al cambiar el query shape de Overpass y el matching de nombre de calle), se sube el
    prefijo de versión — un resultado viejo cacheado bajo `v3` con precisión `street`/`area` jamás
    debe eclipsar el resultado mejorado bajo `v4` durante su TTL de 7 días. `FLUSHALL`/borrar todo
    Redis en prod destruiría cachés no relacionados (sesiones, rate-limits, otras quotas) — nunca es
    la herramienta correcta para invalidar solo el geocoding.
- Single-flight lock (evita thundering herd en geocoding concurrente, tanto reverse como el bbox de
  municipio).
- Enriquecimiento cross-street vía Overpass (nombres de calles transversales, `composeBothAxes`/
  `findAxes`, l.1446-1510) — solo para `reverse()`.

## Patrón de Validación

Sintáctica **bloqueante** + geocoding **warning no-bloqueante POR DEFECTO** — pero desde el cambio
de negocio del 2026-09-27 (owner) esto ya **NO** es universal: **envío a domicilio SÍ bloquea**
sobre falta de coordenada resuelta; alta de cliente y libretas de direcciones se quedan
no-bloqueantes. Referencia de validators sintácticos: `checkout.component.ts:751-765`.

```typescript
// Bloqueantes (sintaxis)
Validators.required,
Validators.minLength(N),
Validators.maxLength(N),
Validators.pattern(/.../)
```

| Consumidor | Sin coord resuelta (`forward` null / sin pin) |
| --- | --- |
| `customer-modal`, `dispatch-note-address-editor` (vía `app-address-form-fields`) | **NO bloquea** — solo `addressWarning` (signal), `validChange` sigue en base a validators sintácticos. |
| Checkout ecommerce (`checkout.component.ts`, entrega a domicilio) | **BLOQUEA** Continuar — `hasResolvedCoords()`/`shippingBlockedReason()`/`canProceedFromAddressStep()` (l.1631-1671). Pickup y carritos solo-servicio nunca se gatean. |
| POS envío a domicilio (`pos-shipping-step.component.ts`) | **BLOQUEA** cobrar/guardar — `hasResolvedLocation()` (l.282-285), total muestra "Pendiente" mientras no resuelve. |

El componente compartido `app-address-form-fields` en sí mismo **siempre** se queda no-bloqueante
(`validChange` solo depende de los validators sintácticos) — es el CONSUMIDOR (checkout, POS
shipping) quien añade su propio gate leyendo `has_location`/coords del `addressChange` emitido. Ver
`vendix-shipping-distance-pricing` para la regla de negocio completa ("sin coordenadas, sin
tarifa") que motiva el bloqueo específico de envío a domicilio.

```typescript
readonly addressWarning = signal<string | null>(null);
// ...
this.geocoding.forward(query, { city, state }).subscribe(r => {
  if (r?.lat == null || r?.lng == null) {
    this.addressWarning.set('No pudimos ubicar tu dirección. Marca el punto en el mapa...');
  }
});
```

### Salida por WhatsApp cuando no se puede ubicar (owner, 2026-09-27)

El bloqueo de Continuar en checkout tiene UNA salida, y solo si la tienda la habilita:

- **Disparador:** el comprador toca "Usar mi ubicación automática" y la geolocalización queda
  `denied` / no soportada / falla (`onLocateRequested` + catch de `requestGeolocation` en
  `checkout.component.ts`). Un forward-geocode fallido de la dirección escrita NO dispara el modal —
  ahí el comprador sigue pudiendo marcar el pin.
- **Gate:** `canUseWhatsappFallback` (computed, `checkout.component.ts:357`) lee
  `ecommerce.checkout.whatsapp_checkout === true` + `whatsapp_number` no vacío del domain config.
  Si es `false` se mantiene el toast de antes ("marca tu ubicación en el mapa").
- **UX:** `app-whatsapp-fallback-modal`
  (`private/modules/ecommerce/components/whatsapp-fallback-modal/`) — `isOpen` model, `loading`
  input, `confirm` (no cierra) / `decline` (cierra y enfoca el mapa). El hero sangra a los bordes
  con márgenes negativos que DEBEN igualar el padding responsive del body de `app-modal`
  (`px-3 py-2.5` / `md:px-5 md:py-4`); un margen mayor produce scrollbar horizontal bajo el hero.
- **Envío:** valida la dirección escrita (o la guardada), pide datos de invitado si falta, manda
  `pending_shipping_assignment: true` con la dirección SIN coords y abre `wa.me` con el detalle,
  "Envío: por definir con la tienda" y "Total (sin envío)". Contrato backend y compuertas en
  `vendix-shipping-distance-pricing` regla 7.

### Auto-foco del mapa — humano vs UI (owner, 2026-09-27)

En teléfono, llevar al comprador/cajero al mapa mientras aún teclea es una carrera que siempre pierde
el humano. Reglas vigentes en `app-address-form-fields` (POS, customer-modal, editor de remisión) y
en `checkout.component.ts` (tienda):

1. **Sin forward-geocode incompleto:** `forwardGeocodeFromForm` hace return (y limpia aviso/precisión)
   hasta tener país + departamento + ciudad + `address_line1` (≥5). La línea sola casi nunca
   matchea — no se pide.
2. **Compuerta del auto-foco:** departamento + ciudad + línea llenos. Luego debounce de 500 ms
   (`requestAutoMapFocus`), que se cancela con CUALQUIER cambio de campo de dirección (suscripción
   sin debounce).
3. **No mientras escribe:** si `document.activeElement` es un input/textarea/select dentro del host,
   se espera a un `blur` de un solo uso; el blur re-evalúa en `setTimeout(0)` para que saltar a otro
   campo del mismo form siga esperando.
4. **Una sola vez:** `autoMapFocusDone` — tras el primer auto-foco nunca más scroll automático.
5. **Retenidos hasta el disparo:** abrir el mapa (`showMap`/`advancedOverride`) y el aviso "No
   pudimos ubicar…" (`pendingAddressWarning`) solo se aplican cuando el auto-foco dispara. En el POS
   el mapa se renderiza ENCIMA de los campos: abrirlo o insertar el aviso a mitad de tecleo empuja el
   input fuera de la vista.
6. **Acciones del usuario siempre hacen scroll** (`focusMapHint('user')`: "Usar mi ubicación",
   Continuar sin coords, rechazar WhatsApp) y vacían el aviso pendiente.
7. El pulso `mapHighlight` puede correr siempre; no mueve layout.

Timers/listeners como campos privados planos (no signals: el template no los lee) + limpieza en
`DestroyRef.onDestroy`. Residual conocido: el chip "Ubicando tu dirección…" aún reserva alto durante
el geocode.

## Shared — `app-address-form-fields`

`apps/frontend/src/app/shared/components/address-form-fields/address-form-fields.component.ts`:

- Inputs: `initialAddress`, `center`, `compact`, `dianEndpointBase`, `requirePhone`, `showPhone`,
  `showErrors`, `allowGeolocation` (default `true`; POS mantiene el GPS disponible como acción
  explícita porque el operador puede estar en la dirección del cliente).
- Outputs: `addressChange` (emite el valor del form + `pin_confirmed`, `geocode_precision`,
  `has_location` — l.591-598), `validChange`.
- Signals: `showMap`, `addressWarning`, `coordsSignal`, `precision`, `geocodeLabel`, `mapHighlight`,
  **`pinConfirmed`** (l.236).
- **El mapa/pin NUNCA escribe en los campos de texto de la dirección** — `onLocated(coords)`
  (l.669-681) **solo** fija `latitude`/`longitude` + `coordsSignal` y marca `pinConfirmed = true`;
  el método `prefillFromGeocode` que antes reverse-geocodificaba el punto y rellenaba
  `address_line1`/`city`/`state_province` fue **removido** por directiva del coordinador (2026-09):
  eso producía direcciones que parecían tecleadas por el cliente pero venían de un reverse-geocode
  aproximado. `address_line1`/`address_line2` tienen como fuente el texto del operador; `city` y
  `state_province` vienen de los nombres oficiales elegidos en el catálogo DANE (ver Geografía DANE
  abajo).
- **Lock `pinConfirmed`**: mientras esté en `true`, un forward-geocode disparado por seguir
  tecleando NUNCA sobreescribe la coordenada (`forwardGeocodeFromForm`, l.738 — return inmediato).
  Se resetea a `false` en cuanto `address_line1` cambia de nuevo (l.542-547) — escribir la
  dirección de nuevo significa que es una dirección DISTINTA, así que el pin anterior ya no aplica.
- **Badge de precisión** (`precisionBadge`, l.246-260+): un pin confirmado siempre gana visualmente
  sobre cualquier precisión de geocode previa ("Punto confirmado en el mapa"); si no, muestra el
  texto asociado a `exact`/`interpolated`/`intersection`/`street`/`area`.
- Reutilizable en **customer-modal**, **dispatch-note-address-editor** y **POS shipping step**
  (mismo componente, tres consumidores). El **checkout ecommerce NO lo usa** — `checkout.component.ts`
  monta `app-address-map-picker` directamente (l.198,508 del template) con su propio handler
  `onMapLocated(coords)` (l.1244) y su propia lógica de `hasResolvedCoords`/`shippingBlockedReason`
  (ver Patrón de Validación arriba) en vez de delegar en este wrapper — mismo contrato de
  "el mapa solo entrega coords", implementado por separado.

### Geografía DANE de la dirección

El formulario compartido, por ahora solo para Colombia, elige Departamento → Ciudad con dos
`app-selector` buscables. Departamento usa el código DANE de 2 dígitos; Ciudad usa el código
municipal DANE de 5 dígitos y permanece deshabilitada hasta elegir departamento. No se muestra un
tercer selector «Municipio (DANE)» ni se permite texto libre en ciudad/departamento. Al elegir el
municipio, los controles existentes conservan los nombres oficiales en `city` y `state_province`, y
guardan el código en `municipality_code`. Este código es requerido por la validación del form
compartido, aunque `AddressPayload.municipality_code` siga siendo opcional para snapshots/contratos
legados fuera del formulario.

- Departamentos: `GET /store/addresses/dian/departments`. Municipios: `/store/addresses/dian/municipalities?department_code=NN`.
  `DianMunicipalityLookupService.listDepartments()` cachea por base de endpoint;
  `listByDepartment(code)` cachea por base + código y obtiene el departamento completo sin límite
  de paginación (importante, por ejemplo, para Antioquia).
- Al editar, hidratar primero por `resolveByCode(municipality_code)` y, si no hay código, intentar
  `resolveByName(city, state_province)`. Si no coincide —incluidos los nombres cruzados— dejar los
  selectores vacíos, mostrar una pista con los valores previos y mantener el formulario inválido
  hasta una elección explícita. Nunca inventar una selección.
- El geocoding actualiza coordenadas/precisión, pero nunca sobrescribe `city`, `state_province`, el
  código seleccionado ni la geografía oficial elegida.

### Recentrar el mapa en la dirección

`app-address-map-picker` tiene un control independiente de geolocalización: vuela con `map.flyTo`
al marcador actual (si existe) o al centro real de la dirección, con zoom 16. Está deshabilitado
cuando no hay punto real (el centro inicial de Colombia no cuenta). El clic no usa GPS, no emite
`located` y no cambia coordenadas. El botón GPS, debajo de fullscreen, es un control distinto y solo
solicita ubicación tras un clic explícito y el permiso del navegador; nunca se ejecuta automáticamente.
Su resultado actualiza únicamente coordenadas, sin inferir/sobrescribir departamento o ciudad, que
siguen gobernados por el catálogo DANE. Retirar el control/destruir el componente debe limpiar
listener y referencias.

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

- `apps/frontend/src/app/private/modules/ecommerce/pages/checkout/checkout.component.ts:495` —
  `inject(GeocodingService)`; `l.991,1006` — `handleUnresolvedGeocode`/`clearGeocodedCoords`;
  `l.1038` — `useAutoLocation` (GPS consent); `l.1244,1255` — `onMapLocated`/`setMapCoords`;
  `l.1631,1650,1669` — `hasResolvedCoords`/`shippingBlockedReason`/`canProceedFromAddressStep`.
- `apps/frontend/src/app/private/modules/store/orders/services/store-orders.service.ts:878,896` —
  `createCustomerAddress` / `updateOrderShippingAddress` (archivo relocalizado — ya NO vive bajo
  `ecommerce/services/`).
- `apps/frontend/src/app/private/modules/ecommerce/components/address-map-picker/address-map-picker.component.ts:110,127` — API pública (`center` input, `located` output).
- `apps/frontend/src/app/private/modules/ecommerce/services/geocoding.service.ts:68,102` — `reverse` / `forward` (frontend).
- `apps/backend/src/domains/ecommerce/geocoding/geocoding.service.ts:283-467` — cascade `forward` completa (backend).
- `apps/backend/src/domains/ecommerce/geocoding/google-geocoding.provider.ts` — fallback Google.
- `apps/backend/src/domains/ecommerce/geocoding/colombian-address.util.ts` — parser de nomenclatura.
- `apps/frontend/src/app/shared/components/address-form-fields/address-form-fields.component.ts:669,236,246` — `onLocated`, `pinConfirmed`, `precisionBadge`.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/steps/pos-shipping-step.component.ts:282` — `hasResolvedLocation`; template `l.104,259` — `[allowGeolocation]="true"`.

## Rules

- Mandar claves DTO (`address_line_1`, `state`, `country`) al backend, **NO** claves Prisma.
- El geocoding warning sigue **no-bloqueante** en customer-modal/dispatch-note editor. Para **envío
  a domicilio** (checkout, POS shipping) ya NO aplica: bloquea Continuar/cobrar sin coord resuelta
  (regla de negocio 2026-09-27, ver Patrón de Validación y `vendix-shipping-distance-pricing`).
- En crear-mode customer-modal, emitir `addressData`; persistir en el padre tras `createCustomer`.
- Snapshot `dispatch_notes.customer_address` usa claves **Prisma** (no DTO).
- `PATCH /store/dispatch-notes/:id/address` no gatea status — display + mapa.
- Re-snapshotear coords correctas arregla el route-map (paso (a) gana).
- Usar `app-address-map-picker` (y su wrapper `app-address-form-fields`) solo para emitir coords;
  **nunca** para prefillear/sobreescribir los campos de texto de la dirección
  (`prefillFromGeocode` fue removido a propósito — ver sección del wrapper arriba).
- El GPS del POS requiere clic/permisos explícitos, solo propone coordenadas y no cambia la ubicación
  oficial DANE; el control «Centrar en la dirección» es una acción aparte y nunca solicita GPS.
- No mandar `user_id`/`organization_id` desde el cliente en `POST /store/addresses` — el service
  deriva `customer_id → user_id`.
- Bump de versión (`geocode:fwd:vN:`) al cambiar la forma de la cascade, **nunca** `FLUSHALL` en
  Redis de prod para invalidar geocoding.
- Nunca loguear `GOOGLE_GEOCODING_API_KEY` ni imprimirla en warns/errores.

## Gotchas

- **swc --watch stale (VirtioFS)**: agregar un endpoint nuevo al backend requiere `docker restart`
  del container — el watch no lo levanta aunque recompiles. Ver `reference_backend_swc_watch_stale`.
- **Caché Nominatim/forward — 7 días éxito, 6 horas null**: reintentar geocoding inmediatamente no
  mejora el resultado; una dirección nueva/rural se reintenta sola pasadas esas 6h. El cacheo de
  null evita saturar la política pública de Nominatim (~1 req/s).
- **Una esquina única de Overpass nunca es confianza por sí sola** — si se toca `tryIntersection`,
  preservar la compuerta `candidateCount <= 1` → ancla ≤ 2 km; quitarla reintroduce resultados
  `interpolated` a kilómetros del punto real, que cobran un tramo equivocado sin aviso.
- **`bias` en la llave de caché SOLO sin `city`/`municipality_code`** — si un caller nuevo siempre
  manda `city`, cambiar solo el `bias` (p.ej. otro método de envío) no invalida la caché: ambos
  leen la misma llave a propósito (ver regla 2 de `vendix-shipping-distance-pricing`). Confundir
  esto con un bug de caché "que no refresca" es el error común.
- **Fallback Google fail-open silencioso**: si `GOOGLE_GEOCODING_API_KEY` falta en un entorno (o el
  tercer bloque `docker run` de un nuevo pipeline de deploy no la inyecta), el fallback simplemente
  nunca corre — no hay error visible, solo un warn `google_no_key` logueado una vez por proceso.
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
- `vendix-redis-quota` — patrón INCR+EXPIRE reusado por el tope mensual de Google
- `vendix-shipping-distance-pricing` — de dónde consume `resolveBuyerCoords` este cascade
  (`forward`) y la regla "sin coordenadas, sin tarifa" que ahora bloquea envío a domicilio
