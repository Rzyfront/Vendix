# Reusable Assets

<!-- [MANDATORY] From Reuse Discovery — one line per asset: `path` — what it provides, or `none — <reason>` if empty. -->

- `apps/backend/src/common/utils/geo-name.util.ts:geoNameInList` — Validación de coincidencia de nombres geográficos con tolerancia a sufijos y prefijos administrativos.
- `apps/backend/src/common/utils/geo-name.util.ts:normalizeGeoName` — Conversión canónica sin tildes, minúsculas, sin artículos ni sufijos D.C.
- `apps/backend/src/common/utils/geo-name.util.ts:countryCodeInList` — Comparación tolerante de código de país ISO 3166-1 alfa-2 y alfa-3.
- `apps/backend/src/common/utils/geo-name.util.ts:postalCodeInList` — Comparación de códigos postales con tolerancia de prefijo bidireccional (>= 4 dígitos).
- `apps/backend/src/common/utils/geo-name.util.ts:isUsableGeoName` — Filtro para evitar tratar IDs numéricos como nombres de ciudad o departamento.
- `apps/frontend/src/app/core/utils/geo-name.util.ts:dedupeGeoNames` — Deduplicación en el guardado de zonas para evitar entradas redundantes.
- `apps/frontend/src/app/services/country.service.ts` — Proveedor de lista de departamentos y ciudades de Colombia para dropdowns.
- `apps/backend/src/domains/store/shipping/shipping-calculator.service.ts:getPickupFallbackOptions` — Fallback controlado a retiro en tienda si y sólo si existe tienda física en la misma ciudad.
