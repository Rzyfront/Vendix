# Database Contract Registry
| Id | Model / table | Columns | R/W | Tenant scoping | Migration | Consumers | Invariant | Verification | Status |
|----|---------------|---------|-----|----------------|-----------|-----------|-----------|--------------|--------|
| DB-01 | `orders` | origin_cash_session_id,store_id,state,remaining_balance | R/W | scoped store + same-store FK | nullable additive | POS/list/close | origin immutable | `bash evidence/verify-db.sh DB-01` | [ ] |
| DB-02 | `cash_register_sessions` | status,summary,pending_orders_tracking_enabled,closed_at,closed_by | R/W | scoped store | additive boolean defaults false; openSession sets true | close/report | one close with snapshot; legacy is explicit | `bash evidence/verify-db.sh DB-02` | [ ] |
| DB-03 | `cash_register_movements` | session_id,order_id,payment_id,type,amount | R/W | scoped store, explicit filter if withoutScope | none | expected/report | no fabricated sale | `bash evidence/verify-db.sh DB-03` | [ ] |
| DB-04 | `payments` | order_id,state,amount | R | scoped store | none | eligibility | succeeded only counts paid | `bash evidence/verify-db.sh DB-04` | [ ] |
| DB-05 | `order_items` | order_id,state,stock fields | R/W | relational store | none | finish flow | stock once | `bash evidence/verify-db.sh DB-05` | [ ] |
| DB-06 | `order_events` | order_id,type,payload | R/W | scoped store | maybe event type | audit/SSE | one completion event | `bash evidence/verify-db.sh DB-06` | [ ] |
| DB-07 | `inventory movements/levels` | order/item source | R/W | operating scope | none | finish flow | no stock delta on failure | `bash evidence/verify-db.sh DB-07` | [ ] |
| DB-08 | `accounting entries` | source order/event | R/W | fiscal scope | none | COGS after finish | no duplicate posting | `bash evidence/verify-db.sh DB-08` | [ ] |
| DB-09 | `cash register registers` | id,store_id | R | scoped store | none | origin check | same store as order | `bash evidence/verify-db.sh DB-09` | [ ] |
| DB-10 | `orders legacy` | origin_cash_session_id | R | scoped store | no inferred backfill | compatibility | origin is never inferred from collection session | `bash evidence/verify-db.sh DB-10` | [ ] |
| DB-11 | `accounting_entry_failures` | handler_key,source_id,event_payload,resolved_at | R/W | store + session in payload | none | payment recovery/close guard | unresolved marker blocks close; delivery idempotent | `npm run test:path -- src/domains/store/cash-registers/movements/movements.service.spec.ts -t 'señal durable'` | [ ] |
