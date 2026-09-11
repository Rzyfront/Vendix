# Database Contract Registry

| Id | Model / table | Columns | R/W | Tenant scoping | Migration | Consumers | Invariant | Verification | Status |
|----|---------------|---------|-----|----------------|-----------|-----------|-----------|--------------|--------|
| DB-01 | `orders` | `customer_id,store_id` | R/W | scoped client por store | none | payments,invoicing | `customer_id` es de la tienda | `SELECT id,customer_id FROM orders WHERE id=?` | [ ] |
| DB-02 | `invoices` | `order_id,customer_id` | R/W | relational scope via order | none | invoicing | factura hereda customer orden | `SELECT order_id,customer_id FROM invoices WHERE order_id=?` | [ ] |
| DB-03 | `customers` | `email,document,store_id` | R/W | scoped client por store | none | resolve,search,top | resolve no duplica por email/doc | `SELECT id FROM customers WHERE store_id=? AND email=?` | [ ] |
