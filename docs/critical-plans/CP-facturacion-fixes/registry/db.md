# Database Contract Registry

| Id | Model / table | Columns | R/W | Tenant scoping | Migration | Consumers | Invariant | Verification | Status |
|----|---------------|---------|-----|----------------|-----------|-----------|-----------|--------------|--------|
| DB-01 | `invoices` | `invoice_number` (nullable until send), `status`, `order_id` | W | scoped client via store_id | add-nullable migration (no backfill) | `createFromOrder`, `send` | number assigned exactly once, at send | `SELECT invoice_number FROM invoices WHERE status='draft'` empty after | [ ] |
| DB-02 | resolution sequence (`invoice_number_generator`) | sequence counter | W | per resolution + lock | none | `send` path only after A.1 | no gaps from abandoned drafts | abandoned checkout consumes nothing (probe) | [ ] |
| DB-03 | `orders` | fiscal-failure flag (new, additive) | W | scoped client via store_id | add-column default neutral | webhook auto-send, panel | paid-without-invoice always flagged | sandbox DIAN-down approve → flag set | [ ] |
| DB-04 | idempotency store (new) | `key`, `store_id`, `response`, `expires_at` | W | key scoped by store | new table + TTL | web checkout(s) | replay returns first result; TTL expiry | double-POST probe + expiry probe | [ ] |
