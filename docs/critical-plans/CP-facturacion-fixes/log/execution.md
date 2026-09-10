# Execution Log

| Date | Who | Step | Event | Evidence |
|------|-----|------|-------|----------|
| 2026-09-10 | agent | A.1 | start: branch fix/CP-facturacion-fixes from develop | git branch |
| 2026-09-10 | agent | A.1 | scope: only createFromOrder goes numberless; manual create()/sales/contract keep numbering (explicit acts) | steps/A.1 + this log |
| 2026-09-10 | agent | A.1 | migration 20260910120000 invoice_number nullable (shadow DB broken pre-existing, manual SQL) | prisma/migrations/20260910120000* |
| 2026-09-10 | agent | A.1 | validate() assigns-if-null after identity gate; 7 specs updated; 2 new tests | invoice-flow.service.spec.ts |
| 2026-09-10 | agent | A.1 | tsc clean on touched files; checkout.spec 7 fails pre-existing (verified on base worktree) | jest logs |
| 2026-09-10 | agent | A.1 | invoice-flow 12/12 + 80/80 specs green | jest logs |
| 2026-09-10 | agent | A.2 | ORD_SHIP_CHARGE_001 gate pre-claim in payOrder; order-flow 36/36 green | order-flow.service.spec.ts |
| 2026-09-10 | agent | A.3 | webhook auto-send + fiscal_alert_code migration + panel banner; webhook 14/14 green | webhook-handler.service.spec.ts |
| 2026-09-10 | agent | A.4 | Idempotency-Key e2e (service+controller+storefront); idempotency 5/5 green | checkout-idempotency.service.spec.ts |
| 2026-09-10 | agent | A.5 | tsc backend clean (remaining errors pre-existing in untouched files) | tsc log |
