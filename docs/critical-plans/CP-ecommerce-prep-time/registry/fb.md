# Frontend↔Backend Contract Registry

| Id | Method + route | Request DTO | Response shape | Frontend consumer | Change | Risk | Verification | Status |
|----|----------------|-------------|----------------|-------------------|--------|------|--------------|--------|
| FB-01 | `PATCH /store/settings` | `UpdateSettingsDto.ecommerce.catalog` | `{data:{ecommerce:{catalog:{...}}}}` | `ecommerce.component.ts` save | `+ show_preparation_time?: boolean` | whitelist borra el flag si falta en DTO | `curl PATCH flag true/false; GET diff claves` | [ ] |
| FB-02 | `GET /store/settings` | none | `SettingsResponse.ecommerce.catalog` | `ecommerce.component.ts` init | `none (regression check only)` | cambio de forma rompe el admin | `curl GET; jq .data.ecommerce.catalog` | [ ] |
| FB-03 | `GET /ecommerce/catalog` | `CatalogQueryDto` | `items[] +preparation_time_minutes` | `storefront.component.ts` lista | `+ preparation_time_minutes: number\|null` | tipo distinto rompe el render | `curl lista; jq keys del item 0` | [ ] |
| FB-04 | `GET /ecommerce/catalog/:slug` | `slug` param | `detail +preparation_time_minutes` | ficha de producto | `+ preparation_time_minutes; variante ya lo trae` | detalle mas pobre que la card | `curl detalle; jq keys y variants[0] keys` | [ ] |
| FB-05 | `GET /ecommerce/catalog/config/public` | none | `{ecommerce:{catalog:{show_preparation_time}}}` | lectura del flag en vitrina | `+ passthrough del flag (spread existe)` | flag ausente apaga siempre | `curl config; jq .ecommerce.catalog` | [ ] |
| FB-06 | `POST /ecommerce/checkout` + cart | `CheckoutDto`, cart DTOs | sin cambio | checkout y carrito | `none (regression check only)` | DTO tocado bloquea la venta | `curl checkout sin auth: 401 con shape viejo` | [ ] |
