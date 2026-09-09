# Database Contract Registry

| Id | Model / table | Columns | R/W | Tenant scoping | Migration | Consumers | Invariant | Verification | Status |
|----|---------------|---------|-----|----------------|-----------|-----------|-----------|--------------|--------|
| DB-01 | `shipping_zones` | `store_id,is_active,countries,regions,cities,zip_codes` | R | `store_id` + `is_active` en `resolveZone` | Ninguna | `shipping-calculator.service.ts:332` | Solo lectura; el plan no muta zonas | `SELECT id,name,is_active,regions,cities,zip_codes FROM shipping_zones WHERE store_id=10` | [ ] |
| DB-02 | `shipping_rates` | `shipping_zone_id,is_active,type,base_cost,min_val,max_val,free_shipping_threshold` | R | vía zona + `is_active` método y tarifa | Ninguna | `shipping-calculator.service.ts:91` | Solo lectura; tipo `free` exige rango que cubra el total | `SELECT … FROM shipping_rates WHERE shipping_zone_id IN (…)` tienda 10 | [ ] |
| DB-03 | `shipping_methods` | `type,display_order,min_days,max_days,is_active` | R | `is_active` + `type='pickup'` en fallback | Ninguna | `shipping-calculator.service.ts:96,280` | Solo lectura | Incluido en el SELECT de DB-02 con join | [ ] |
| DB-04 | `addresses` (tienda) | `store_id,type,city,state_province` | R | tipos `PICKUP_CAPABLE_ADDRESS_TYPES` | Ninguna | `getPickupFallbackOptions` | Solo lectura | `SELECT city,type FROM addresses WHERE store_id=10` | [ ] |
