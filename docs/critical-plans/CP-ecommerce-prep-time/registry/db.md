# Database Contract Registry

| Id | Model / table | Columns | R/W | Tenant scoping | Migration | Consumers | Invariant | Verification | Status |
|----|---------------|---------|-----|----------------|-----------|-----------|-----------|--------------|--------|
| DB-01 | `store_settings` | `settings.ecommerce.catalog` JSON | W | `StorePrismaService` por `store_id` | none, JSON sin migracion | `settings.service` PATCH/GET | filas viejas sin clave leen `false` | `SELECT settings->'ecommerce' en seed` || [x] |
| DB-02 | `products`, `product_variants` | `preparation_time_minutes` | R | `EcommercePrismaService` auto scope | none, columna existe | `catalog.service` mappers | proyectar nunca filtra ni escribe | `SELECT prep de 5 productos` || [x] |
| DB-03 | `orders`, `order_items`, cart | sin cambio | - | clientes scoped sin cambio | none | checkout y cart | flujo de venta intacto | spec checkout por path en verde || [x] |
