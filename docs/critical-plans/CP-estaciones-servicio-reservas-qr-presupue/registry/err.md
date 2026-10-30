# Error Code Registry
| Id | Code | HTTP | Emitted when | Frontend behavior | Message shown | Verification | Status |
|----|------|------|--------------|-------------------|---------------|--------------|--------|
| ERR-01 | `STATION_001` | 400 | invalid capability | show fields | Estación incompatible | `bash evidence/verify-err.sh ERR-01` | [x] |
| ERR-02 | `STATION_002` | 409 | occupied interval | refresh slots | Estación ocupada | `bash evidence/verify-err.sh ERR-02` | [x] |
| ERR-03 | `STATION_003` | 409 | provider busy | refresh slots | Proveedor ocupado | `bash evidence/verify-err.sh ERR-03` | [x] |
| ERR-04 | `STATION_004` | 404 | station missing or cross store | hide detail | Estación no disponible | `bash evidence/verify-err.sh ERR-04` | [x] |
| ERR-05 | `STATION_005` | 409 | active session exists | open existing | Ya hay atención activa | `bash evidence/verify-err.sh ERR-05` | [x] |
| ERR-06 | `STATION_006` | 409 | invalid lifecycle | refresh state | Estado cambió | `bash evidence/verify-err.sh ERR-06` | [x] |
| ERR-07 | `STATION_007` | 422 | missing customer or subject data | focus required | Completa datos requeridos | `bash evidence/verify-err.sh ERR-07` | [x] |
| ERR-08 | `SERVICE_BUDGET_001` | 409 | charge exceeds approved limit | create proposal | Requiere aprobación | `bash evidence/verify-err.sh ERR-08` | [x] |
| ERR-09 | `SERVICE_BUDGET_002` | 409 | proposal stale/version mismatch | refresh quote | Propuesta cambió | `bash evidence/verify-err.sh ERR-09` | [x] |
| ERR-10 | `SERVICE_BUDGET_003` | 410 | approval expired/revoked | request again | Enlace vencido | `bash evidence/verify-err.sh ERR-10` | [x] |
| ERR-11 | `SERVICE_BUDGET_004` | 403 | proof invalid | show denied | No se pudo validar | `bash evidence/verify-err.sh ERR-11` | [x] |
| ERR-12 | `SERVICE_QR_001` | 410 | session token invalid/expired | show safe closed | Enlace no disponible | `bash evidence/verify-err.sh ERR-12` | [x] |
| ERR-13 | `SERVICE_CONTACT_001` | 422 | no usable channel | show manual option | Falta un contacto válido | `bash evidence/verify-err.sh ERR-13` | [x] |
| ERR-14 | `SERVICE_CONTACT_002` | 503 | delivery failed | retry idempotent | No se envió; reintenta | `bash evidence/verify-err.sh ERR-14` | [x] |
| ERR-15 | `SERVICE_BOOKING_001` | 409 | checkout allocation conflict | return to slots | Horario agotado | `bash evidence/verify-err.sh ERR-15` | [x] |
| ERR-16 | `SERVICE_QR_002` | 429 | SSE connection limit | retry later | Demasiadas conexiones | `bash evidence/verify-err.sh ERR-16` | [x] |
| ERR-17 | `STATION_008` | 409 | Postgres 23P01 exclusion | refresh slots | Horario ocupado | `bash evidence/verify-err.sh ERR-17` | [x] |
| ERR-18 | `STATION_009` | 400 | invalid or past interval | focus date | Horario inválido | `bash evidence/verify-err.sh ERR-18` | [x] |
| ERR-19 | `STATION_010` | 403 | missing staff permission | deny action | Sin permiso | `bash evidence/verify-err.sh ERR-19` | [x] |
| ERR-20 | `STATION_011` | 409 | expired hold | select new slot | Reserva vencida | `bash evidence/verify-err.sh ERR-20` | [x] |
| ERR-21 | `STATION_012` | 400 | public bypass flag or wrong DTO | show validation | Solicitud inválida | `bash evidence/verify-err.sh ERR-21` | [x] |
