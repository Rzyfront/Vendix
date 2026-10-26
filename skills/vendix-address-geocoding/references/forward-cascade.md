# Forward-geocoding backend: parser, cascade, Google, caché

Archivos: `apps/backend/src/domains/ecommerce/geocoding/` (`geocoding.service.ts`, `colombian-address.util.ts`, `google-geocoding.provider.ts`, `geocoding.controller.ts`). Los números de línea cambian: busca por nombre de símbolo.

## Precisión — `GeocodePrecision`

`'exact' | 'interpolated' | 'intersection' | 'street' | 'area'` (orden decreciente; idéntico en backend y frontend `geocoding.service.ts`). Ranking: `precisionRank`.

| Precisión | Significado |
| --- | --- |
| `exact` | `house_number` verificado, o lugar OSM con nombre (POI: shop/amenity/building…) |
| `interpolated` | Caminado `placa` metros desde la esquina DANE, o `RANGE_INTERPOLATED` de Google |
| `intersection` | Esquina DANE (vía × vía generadora) vía Overpass |
| `street` | Calle nombrada sin número |
| `area` | Centroide de barrio/vereda/finca (último recurso) |

`ForwardGeocodeResult`: `lat`, `lng`, `precision?`, `source?: 'osm'|'google'` (ausente = osm), `label?` (solo display).

Firma backend: `forward(query, city?, state?, opts?: { municipalityCode?, bias? })`. `municipalityCode` (DANE 5 dígitos) pinea el bbox exacto; `bias` (típicamente origen del método de envío) solo se usa sin `city`. El frontend solo puede mandar `city`/`state`.

## Parser colombiano — `colombian-address.util.ts`

Puro (sin red/Redis/DI), spec `colombian-address.util.spec.ts`. `normalizeColombianAddress(input)` → `ParsedColombianAddress` con `kind: 'dane' | 'interseccion' | 'manzana' | 'rural' | 'libre'`.

- `VIA_TIPO_TABLE` (longest-match): Calle/Cll/Cl, Carrera/Kra/Cra/Kr/Cr, Diagonal/Diag/Dg, Transversal/Transv/Tv/Tr, Avenida/Av/Avda, AC, AK, Autopista/Aut, Circular/Cir/CQ, Circunvalar/CV, Vía.
- `parseViaNumberTokens`: número, letra ("45A" → "45 A", `splitAttachedLetter`), Bis, cuadrante (sur/norte/este/oeste).
- Intersecciones "con"/"y" (`CON_Y_RE`) → `kind: 'interseccion'`. Rangos "13-02 al 13-20" (`AL_RANGE_RE`) → `placaRangoFin`.
- Km rural `Km <n> Vía <destino>` (`tryExtractAreaSegment`) → `kind: 'rural'`.
- Nombre histórico entre paréntesis: el paréntesis es la vía real; el texto previo va a `legacyName`.
- `COMPLEMENT_RE` despoja torre/apto/interior/casa/oficina/local/bodega/modulo/piso/manzana/lote/bloque/etapa con `\b` obligatorio (no romper "Torres", "Casablanca", "Interamericana"). vereda/corregimiento/sector/finca se extraen como segmento de área, no complemento.
- `selectBestCandidate`: clasifica Nominatim en `exact`/`street`/`area`, descarta `admin` (solo ciudad/depto/país), desempata por ciudad y luego `importance`.

## Cascade `GeocodingService.forward`

Nunca lanza: agotada → `{ lat: null, lng: null }`. Se detiene en el primer resultado ≥ `intersection`.

1. **Bbox del municipio** (`resolveMunicipalityBbox`): Nominatim `boundingbox` (caché 30 d) con fallback Overpass por nombre administrativo (caché 24 h si no resuelve). Sin `city`: bbox de ~25 km alrededor de `bias` (`BIAS_BBOX_RADIUS_KM`).
2. **Intersección DANE + interpolación** (`tryIntersection`): busca la transversal dentro del bbox y la principal `around` (40 m). Placa ≤ `MAX_INTERPOLATION_METERS = 150` → camina (`walkAlongWayFromPoint`) y sube a `interpolated`. `selectBestCorner` desempata por cercanía (bias → centro bbox → cercanía mutua); no es rechazo por distancia.
   - Mirrors Overpass en paralelo (`OVERPASS_MIRRORS`, `raceOverpassMirrors`): `overpass.openstreetmap.fr`, `overpass-api.de`, `maps.mail.ru`. `INTERSECTION_TIMEOUT_MS = 8000` (2,5 s cortaba `fr`).
3. **Nominatim structured** (`tryStructuredSearch`): `street="<placa> <viaTipo> <viaNum>"` con `viewbox`+`bounded=1`.
4. **Nominatim free-text** (`tryFreeText`), con reintento sin bbox si el filtro eliminó todo.
5. **Google** (`tryGoogleFallback`): solo si lo mejor OSM es null/`street`/`area`; gana solo dentro del bbox y con precisión ESTRICTAMENTE mejor.

Presupuestos duros: `MAX_FORWARD_EXTERNAL_REQUESTS = 5` (Nominatim ~1 req/s) y `FORWARD_OVERALL_BUDGET_MS = 15000` (reloj total, incluye bbox).

Rural/manzana (`tryRural`/`tryAreaName`): `rural` busca punto sobre la vía desde el Km (`tryRoadPoint`) y si no, el nombre de vereda/corregimiento/sector/finca (`area`); `manzana` busca el nombre de urbanización/barrio/conjunto.

### Compuerta de plausibilidad de la esquina (invariante)

`selectBestCorner` devuelve `candidateCount`.
- Varias candidatas → se acepta (se autocorrobora).
- Una sola → contrastar con ancla independiente (`resolveIntersectionAnchor`): Nominatim estructurado de la MISMA dirección con placa (`"<cruce>-<placa> <vía>"`, nunca la calle pelada), si no, centroide de la vía principal. A más de `INTERSECTION_ANCHOR_MAX_METERS = 2000` m o sin ancla → descartar (warn `Intersection corner rejected`) y caer a `street`/`area`.
- No aplicar la compuerta a multi-candidato (Nominatim es mal ancla para calles largas: rechazos falsos).
- Caso origen: "Calle 14 # 26-13, Bogotá" daba esquina rural a ~15 km como `interpolated`.
- Limitación conocida: el sentido de interpolación sigue el orden de vértices OSM, no la numeración (Cra 13 # 62-40 queda a ~99 m).

## Fallback Google — `google-geocoding.provider.ts`

- Sin `GOOGLE_GEOCODING_API_KEY` → deshabilitado (`geocode()` = null, warn `google_no_key` una vez por proceso).
- Tope mensual `GOOGLE_GEOCODING_MONTHLY_CAP` (default 5000) con `checkAndIncrementCap`: llave `geocode:google:YYYYMM` (UTC), INCR + EXPIRE (TTL 35 d), **INCR antes de llamar** (Google cobra por request), distinto del "consumir tras éxito" de cuotas IA.
- Fail-open total: sin key, tope, red, timeout 4000 ms, `ZERO_RESULTS`, `OVER_QUERY_LIMIT`, `REQUEST_DENIED`, JSON malo o sin `geometry.location` → null; nunca rompe el forward.
- Nunca loguear la key: warns con `JSON.stringify({ reason })`, sin `apiKey`/`params`.
- `mapPrecision`: `ROOFTOP`→exact, `RANGE_INTERPOLATED`→interpolated, `GEOMETRIC_CENTER`→intersection (types `intersection`) / street (`route`) / area, `APPROXIMATE`→area.
- Prod: key y tope en Secrets Manager `vendix/production/app`; `.github/workflows/deploy-backend-ec2.yml` los extrae y los inyecta con `-e` en AMBOS bloques `docker run` (normal y rollback). Un nuevo bloque `docker run` debe repetirlos o Google nunca corre (silencioso).

## Proxy y caché

- `GET /ecommerce/geocoding/reverse?lat=&lng=` → `NormalizedAddress`; caché `geocode:rev:*` 30 d; enriquecimiento cross-street Overpass (`composeBothAxes`/`findAxes`) solo en reverse.
- `GET /ecommerce/geocoding/forward?q=&city=&state=&municipality_code=` — `@OptionalAuth` público (guest checkout). Sin `city` y con header `x-store-id`, el controller resuelve `bias` desde el primer `shipping_methods` activo con origen pineado (`resolveShippingOriginBias`) bajo `RequestContextService.runIsolated`; cualquier fallo se ignora.
- `GET /ecommerce/geocoding/municipality-center?city=&state=` — centro del bbox SOLO para encuadrar el mapa. Nunca es pin, coordenada de entrega ni base de cotización.
- Caché forward versionada `geocode:fwd:vN:` (hoy **v6**, `buildForwardCacheKey`): línea normalizada + city + state + municipality_code; 7 d éxito / 6 h null (`FORWARD_NULL_CACHE_TTL_SECONDS`). `bias` entra a la llave SOLO sin city ni municipality_code (`hasLocationContext`), redondeado a 2 decimales: cotización y confirmación de la misma dirección leen la misma llave (ver `vendix-shipping-distance-pricing`).
- Single-flight lock en reverse y bbox de municipio.
