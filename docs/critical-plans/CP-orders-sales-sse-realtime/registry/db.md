# Database Contract Registry

| Id | Model / table | Columns | R/W | Tenant scoping | Migration | Consumers | Invariant | Verification | Status |
|----|---------------|---------|-----|----------------|-----------|-----------|-----------|--------------|--------|
| DB-01 | `orders` | `id,store_id,order_number,state` | R | `RequestContextService.store_id` | `none` | `orders.service findAll/findOne` | `stream solo pinta store_id propio` | `SELECT id,store_id FROM orders WHERE id=123` vs evento | [ ] |
| DB-02 | `orders` | `grand_total,currency,created_at` | R | `RequestContextService.store_id` | `none` | `hidratacion GET /:id` | `hidratado == fila REST normalizada` | `curl /store/orders/123 | jq .data.grand_total` | [ ] |
