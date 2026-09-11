# Critical Files

<!-- [MANDATORY] Concrete paths only, zero wildcards — one line per file: `path/to/file.ts` — role. -->

- `apps/backend/src/domains/store/shipping/shipping-calculator.service.ts` — Resolución multi-zona, matching jerárquico por especificidad y cotización de tarifas.
- `apps/backend/src/domains/store/shipping/shipping.controller.ts` — Endpoint público `POST /shipping/calculate` para cálculo de tarifas de envío.
- `apps/backend/src/domains/store/shipping/services/store-shipping-zones.service.ts` — CRUD de zonas y tarifas de tienda en el backend con scoping por store_id.
- `apps/backend/src/domains/store/shipping/dto/shipping_calc.dto.ts` — DTOs de cálculo de envío (`CalculateShippingDto`, `ShippingAddressDto`, `CartItemCalcDto`).
- `apps/backend/src/common/utils/geo-name.util.ts` — Utilidades de normalización lingüística de ciudades, departamentos, países y códigos postales en backend.
- `apps/backend/src/common/utils/geo-name.util.spec.ts` — Suite de pruebas unitarias Jest para normalización y matching geográfico.
- `apps/frontend/src/app/core/utils/geo-name.util.ts` — Espejo frontend de normalización y deduplicación de nombres geográficos.
- `apps/frontend/src/app/private/modules/ecommerce/pages/checkout/checkout.component.ts` — Mapeo de direcciones, llamada a cotización y evaluación de cobertura (`shipping_coverage`).
- `apps/frontend/src/app/private/modules/ecommerce/pages/checkout/checkout.component.html` — Vista de checkout, selector de envío y banner de cobertura vacía.
- `apps/frontend/src/app/private/modules/store/settings/shipping/components/zone-modal/zone-modal.component.ts` — Modal de creación/edición de zonas geográficas en admin de tienda.
- `apps/frontend/src/app/private/modules/store/settings/shipping/components/add-rate-wizard-modal/add-rate-wizard-modal.component.ts` — Wizard paso a paso para asignación de zona y tarifa a método de envío.
- `apps/frontend/src/app/private/modules/store/settings/shipping/services/shipping-methods.service.ts` — Servicio Angular para CRUD de métodos, zonas y tarifas.
