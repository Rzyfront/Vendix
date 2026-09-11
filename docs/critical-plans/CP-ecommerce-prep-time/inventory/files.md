# Critical Files

- `apps/backend/src/domains/store/ecommerce/dto/ecommerce-settings.dto.ts` — DTO del catalogo; se agrega el flag.
- `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts` — interface; se agrega el flag al bloque catalog.
- `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts` — defaults; el flag nace en false.
- `apps/backend/src/domains/store/settings/dto/update-settings.dto.ts` — conecta EcommerceSettingsDto con whitelist.
- `apps/backend/src/domains/store/settings/settings.service.ts` — merge y validacion con whitelist true.
- `apps/backend/src/domains/ecommerce/catalog/catalog.service.ts` — proyeccion aditiva y lectura del flag.
- `apps/backend/src/domains/ecommerce/catalog/catalog.controller.ts` — rutas listado, detalle y config publica.
- `apps/backend/src/domains/ecommerce/catalog/catalog.service.spec.ts` — specs del catalogo para el sweep.
- `apps/frontend/src/app/core/models/store-settings.interface.ts` — espejo frontend del flag.
- `apps/frontend/src/app/private/modules/store/ecommerce/ecommerce.component.ts` — toggle admin del flag.
- `apps/frontend/src/app/private/modules/store/ecommerce/interfaces/index.ts` — tipo admin del flag.
- `apps/frontend/src/app/public/ecommerce/components/storefront/storefront.component.ts` — indicador en vitrina.
