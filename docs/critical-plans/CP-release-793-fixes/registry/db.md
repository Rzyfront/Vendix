# Database Contract Registry

| Id | Model / table | Columns | R/W | Tenant scoping | Migration | Consumers | Invariant | Verification | Status |
|----|---------------|---------|-----|----------------|-----------|-----------|-----------|--------------|--------|
| DB-01 | `carts` + `cart_items` | `state`, `last_activity_at` | R | `store_id` en servicio | none | analytics service (5 queries) | Derivada: active + inactivo X + con items | SQL fixture before/after | [ ] |
| DB-02 | `shipping_rates` | `free_shipping_threshold` | R | `store_id` en servicio | none | shipping-calculator | 0 = gratis explicito documentado | SELECT filas <=0 en prod | [ ] |
| DB-03 | `pqrs` | `store_id`, `tags` | R | gate plataforma en publico | none | pqr.service tracking | Publico solo ve plataforma | curl tienda→404 | [ ] |
| DB-04 | `users`+`roles` | `roles.name` | R | `organization_id` NOT NULL | none | pqr-notifications.listener | Roles canonicos compartidos | Test con super_admin/owner | [ ] |
| DB-05 | `invoice_items` | `price_unit_quantity` y lineas | R | scoped por store | none | kernel NC/ND + UBL | Taxes derivados por kernel | Traza + spec en verde | [ ] |
