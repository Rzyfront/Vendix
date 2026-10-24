# Database Contract Registry
| Id | Model / table | Columns | R/W | Tenant scoping | Migration | Consumers | Invariant | Verification | Status |
|----|---------------|---------|-----|----------------|-----------|-----------|-----------|--------------|--------|
| DB-01 | `service_stations` | store_id,name,status,capacity,public_id | R/W | scoped store | additive | admin/QR | unique name per store | `bash evidence/verify-db.sh DB-01` | [x] |
| DB-02 | `service_station_services` | station_id,product_id | R/W | relational store | additive | availability | product is service same store | `bash evidence/verify-db.sh DB-02` | [x] |
| DB-03 | `service_station_providers` | station_id,provider_id | R/W | relational store | additive | availability | provider same store | `bash evidence/verify-db.sh DB-03` | [x] |
| DB-04 | `service_station_schedules` | station_id,weekday,time | R/W | relational store | additive | availability | valid local time | `bash evidence/verify-db.sh DB-04` | [x] |
| DB-05 | `service_station_exceptions` | station_id,start_at,end_at | R/W | relational store | additive | availability | no invalid span | `bash evidence/verify-db.sh DB-05` | [x] |
| DB-06 | `service_allocations` | store_id,station_id,provider_id,booking_id,session_id,start_at,end_at,expires_at,state | R/W | scoped store | additive exclusion | bookings/POS | no active overlap | `bash evidence/verify-db.sh DB-06` | [x] |
| DB-07 | `bookings` | station allocation relation | R/W | scoped store | nullable relation | all reservation paths | legacy rows remain valid | `bash evidence/verify-db.sh DB-07` | [x] |
| DB-08 | `service_sessions` | store_id,station_id,booking_id,order_id,status | R/W | scoped store | additive | station/order | one active per station | `bash evidence/verify-db.sh DB-08` | [x] |
| DB-09 | `service_subjects` | session_id,type,label,metadata | R/W | relational store | additive | open/public | minimum PII | `bash evidence/verify-db.sh DB-09` | [x] |
| DB-10 | `service_session_tokens` | session_id,hash,expires_at,revoked_at | R/W | relational store | additive | public QR | no plaintext at rest | `bash evidence/verify-db.sh DB-10` | [x] |
| DB-11 | `service_progress_events` | session_id,kind,public_text,actor_id | R/W | relational store | additive | staff/public SSE | ordered immutable events | `bash evidence/verify-db.sh DB-11` | [x] |
| DB-12 | `service_budgets` | session_id,amount,currency,version | R/W | relational store | additive | order guard | approved limit immutable/versioned | `bash evidence/verify-db.sh DB-12` | [x] |
| DB-13 | `service_change_proposals` | session_id,order_version,snapshot_hash,lines,tax,discount,currency,total,status,expires_at | R/W | relational store | additive | contact/approve | exact proposal only | `bash evidence/verify-db.sh DB-13` | [x] |
| DB-14 | `service_proposal_decisions` | proposal_id,decision,actor,time,proof | R/W | relational store | additive | consent audit | one decision per version | `bash evidence/verify-db.sh DB-14` | [x] |
| DB-15 | `service_contact_attempts` | proposal_id,channel,status,recipient | R/W | relational store | additive | email/action | idempotent dispatch | `bash evidence/verify-db.sh DB-15` | [x] |
| DB-16 | `orders/order_items` | session relation; version,lines/totals | R/W | scoped store | nullable relation | POS/editor/checkout | no excess unapproved | `bash evidence/verify-db.sh DB-16` | [x] |
| DB-17 | `provider_services` | provider_id,product_id | R | relational store | none | capability validation | provider offers product | `bash evidence/verify-db.sh DB-17` | [x] |
| DB-18 | `order_events` | type,payload,order_id | R/W | scoped store | enum event | order detail | audit order mutation | `bash evidence/verify-db.sh DB-18` | [x] |
| DB-19 | `products` | requires_station | R/W | scoped store | additive default false | product/availability | only service enables it | `bash evidence/verify-db.sh DB-19` | [x] |
| DB-20 | `bookings` | future active legacy rows | R/W | scoped store | reconcile before flag | activation | no future unallocated conflict | `bash evidence/verify-db.sh DB-20` | [x] |
