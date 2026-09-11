# Reusable Assets

- `apps/backend/src/domains/store/ecommerce/dto/ecommerce-settings.dto.ts` — patron opt-in `enable_sale_unit_selector` con `=== true`.
- `apps/backend/src/domains/ecommerce/catalog/catalog.service.ts` — `getCatalogSettings`, `getPublicConfig`, `hydratePublicSaleUnits` con degradado a respuesta historica.
- `apps/frontend/src/app/private/modules/store/ecommerce/ecommerce.component.ts` — `SettingToggleComponent` y guardado explicito de settings.
- `apps/frontend/src/app/public/ecommerce/components/storefront/storefront.component.ts` — `ConfigFacade`, `app-badge`, `app-icon`, signals.
- `apps/frontend/src/app/private/modules/store/restaurant-ops/kds/components/kds-ticket-card/kds-ticket-card.component.ts` — semantica de minutos y descarte de 0/null.
