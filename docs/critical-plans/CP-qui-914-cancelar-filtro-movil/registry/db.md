# Database Contract Registry

| Id | Model / table | Columns | R/W | Tenant scoping | Migration | Consumers | Invariant | Verification | Status |
|----|---------------|---------|-----|----------------|-----------|-----------|-----------|--------------|--------|
| DB-01 | `orders` | `id,store_id,state` | R en lista; W por PATCH existente | `RequestContextService.store_id` en backend | Ninguna | `OrdersService.findAll/update` | UI no escribe sin confirmar ni cambia de tienda | Playwright: PATCH count 0 antes / 1 después; comparar store_id en fixture dev | [ ] |
