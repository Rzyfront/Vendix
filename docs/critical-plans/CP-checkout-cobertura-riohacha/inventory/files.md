# Critical Files

<!-- [MANDATORY] Concrete paths only, zero wildcards — one line per file: `path/to/file.ts` — role. -->

- `apps/backend/src/domains/store/shipping/shipping-calculator.service.ts` — `calculateRates`/`resolveZone`/`getPickupFallbackOptions`; decide qué opciones ve el checkout.
- `apps/backend/src/common/utils/geo-name.util.ts` — normalización y match de región/ciudad/CP (fix 61a5a6f5 vive aquí).
- `apps/backend/src/common/utils/geo-name.util.spec.ts` — 9 tests del match (evidencia de que el fix compila y pasa).
- `apps/backend/src/domains/store/shipping/shipping.controller.ts` — `POST /shipping/calculate?store_id=` público.
- `apps/frontend/src/app/private/modules/ecommerce/services/cart.service.ts` — `getShippingEstimates()`; único llamador del cálculo.
- `apps/frontend/src/app/private/modules/ecommerce/pages/checkout/checkout.component.ts` — `shippableOptions`, `fetchShipping`, `nextStep`, `canProceedFromAddress`.
- `apps/frontend/src/app/private/modules/ecommerce/pages/checkout/checkout.component.html` — rama de lista vs estado vacío (línea 324).
- `.github/workflows/deploy-s3.yml` — deploy frontend solo en push a `main` (+ dispatch manual).
- `.github/workflows/deploy-backend-ec2.yml` — deploy backend solo en push a `main` (+ dispatch manual).
- `apps/backend/prisma/schema.prisma` — modelos `shipping_zones`, `shipping_rates`, `shipping_methods` (lectura de referencia, sin migración en este plan).
