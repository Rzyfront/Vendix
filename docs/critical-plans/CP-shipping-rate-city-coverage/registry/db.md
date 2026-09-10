# Database Contract Registry

| Id | Model / table | Columns | R/W | Tenant scoping | Migration | Consumers | Invariant | Verification | Status |
|----|---------------|---------|-----|----------------|-----------|-----------|-----------|--------------|--------|
| DB-01 | `shipping_zones` | `id, store_id, name, countries, regions, cities, zip_codes, is_active` | R | scoped client via store_id | ninguna | `shipping-calculator.service.ts:332` | Solo zonas activas del store_id | SELECT zonas de store 10 | [ ] |
| DB-02 | `shipping_rates` | `id, shipping_zone_id, shipping_method_id, type, base_cost, min_val, max_val, is_active` | R | join shipping_zone.store_id | ninguna | `shipping-calculator.service.ts:91` | Tarifas activas de zonas que matchean | SELECT tarifas por zona | [ ] |
| DB-03 | `shipping_methods` | `id, store_id, name, type, is_active, is_system` | R | store_id = currentStore OR is_system | ninguna | `shipping-calculator.service.ts:95` | Solo métodos activos en storefront | SELECT métodos activos | [ ] |
| DB-04 | `addresses` | `id, user_id, store_id, city, state_province, country_code, type` | R | store_id = currentStore | ninguna | `shipping-calculator.service.ts:251` | Fallback pickup solo si tienda física en ciudad | SELECT direcciones físicas store 10 | [ ] |
