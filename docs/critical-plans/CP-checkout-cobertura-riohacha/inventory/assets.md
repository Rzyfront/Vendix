# Reusable Assets

<!-- [MANDATORY] From Reuse Discovery — one line per asset: `path` — what it provides, or `none — <reason>` if empty. -->

- `apps/backend/src/common/utils/geo-name.util.ts` — `normalizeGeoName`, `geoNameInList`, `postalCodeInList`, `isUsableGeoName`; probadas con el payload real (Riohacha/La Guajira/440001).
- `apps/backend/src/domains/store/shipping/shipping-calculator.service.ts:382-391` — `logger.warn` cuando ninguna zona cubre (huella en logs para confirmar el descarte en prod).
- `apps/frontend/src/app/private/modules/ecommerce/pages/checkout/checkout.component.html:386-403` — estado vacío accionable ya existente que ahora sí se alcanza.
- `ERROR_MESSAGES['ORD_SHIP_NO_ZONE_001']` — mensaje de sin-cobertura reutilizado en el nuevo camino.
- Evidencia ejecutada: `node` contra `tsc` fresco de `geo-name.util.ts` (región La Guajira vs [Guajira]: false antes del fix, true después; zip 440001 vs [44001]: false siempre — no es prefijo).
