# Error Code Registry
| Id | Code | HTTP | Emitted when | Frontend behavior | Message shown | Verification | Status |
|----|------|------|--------------|-------------------|---------------|--------------|--------|
| ERR-01 | `CASH_SESSION_PENDING_001` | 409 | pending decision absent | open review | Revisa órdenes pendientes | `bash evidence/verify-err.sh ERR-01` | [ ] |
| ERR-02 | `CASH_SESSION_PENDING_002` | 409 | pending fingerprint stale | refetch list and cash | La lista cambió | `bash evidence/verify-err.sh ERR-02` | [ ] |
| ERR-03 | `CASH_SESSION_PENDING_003` | 400 | override reason missing | focus reason | Escribe el motivo | `bash evidence/verify-err.sh ERR-03` | [ ] |
| ERR-04 | `CASH_SESSION_PENDING_004` | 409 | legacy ambiguous in active session | show mapping task | Hay órdenes sin asignar | `bash evidence/verify-err.sh ERR-04` | [ ] |
| ERR-05 | `CASH_SESSION_PENDING_005` | 409 | unresolved refund movement or deferred confirmed-sale movement for this session | keep close open; retry movement delivery | Hay un movimiento de caja pendiente de registrar | `bash evidence/verify-err.sh ERR-05` | [ ] |
| ERR-06 | `CASH_SESSION_PENDING_006` | 409 | session already closed | reload session | La caja ya cerró | `bash evidence/verify-err.sh ERR-06` | [ ] |
| ERR-07 | `CASH_BULK_001` | 409 | one order ineligible | show reasons | Hay órdenes que requieren atención | `bash evidence/verify-err.sh ERR-07` | [ ] |
| ERR-08 | `CASH_BULK_002` | 409 | order changed after preview | refetch preview | Las órdenes cambiaron | `bash evidence/verify-err.sh ERR-08` | [ ] |
| ERR-09 | `CASH_BULK_003` | 503 | transaction/outbox failed | no partial success | No se aplicó el lote | `bash evidence/verify-err.sh ERR-09` | [ ] |
| ERR-10 | `CASH_BULK_004` | 400 | empty/oversize/foreign IDs | focus selection | Selección inválida | `bash evidence/verify-err.sh ERR-10` | [ ] |
| ERR-11 | `CASH_SESSION_EXPECTED_STALE_001` | 409 | expected cash changed | recount cash | El efectivo esperado cambió | `bash evidence/verify-err.sh ERR-11` | [ ] |
| ERR-12 | `CASH_SESSION_PENDING_007` | 404 | cross-store order or session | hide row | No disponible | `bash evidence/verify-err.sh ERR-12` | [ ] |
| ERR-13 | `CASH_SESSION_MOVEMENT_RACE_001` | 409 | payment or movement races close | retry in active session | La caja cambió; revisa el cobro | `bash evidence/verify-err.sh ERR-13` | [ ] |
