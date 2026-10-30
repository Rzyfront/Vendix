# Frontend↔Backend Contract Registry
| Id | Method + route | Request DTO | Response shape | Frontend consumer | Change | Risk | Verification | Status |
|----|----------------|-------------|----------------|-------------------|--------|------|--------------|--------|
| FB-01 | `GET /store/service-stations` | query filter | stations page/status | station admin | new CRUD | wrong store | `bash evidence/verify-fb.sh FB-01` | [x] |
| FB-02 | `POST/PATCH /store/service-stations` | StationDto | station with QR status | station form | create/update | bad capacity | `bash evidence/verify-fb.sh FB-02` | [x] |
| FB-03 | `PUT /store/service-stations/:id/services` | service ids | capabilities | station form | M:N | incompatible service | `bash evidence/verify-fb.sh FB-03` | [x] |
| FB-04 | `PUT /store/service-stations/:id/providers` | provider ids | assignments | station form | M:N | cross-store provider | `bash evidence/verify-fb.sh FB-04` | [x] |
| FB-05 | `GET /store/service-stations/availability` | date,service,variant,provider | station slots | booking form | new intersection | stale slot | `bash evidence/verify-fb.sh FB-05` | [x] |
| FB-06 | `GET /store/reservations/availability/:productId` | existing + station option | slots with station | admin booking | + station | capacity leak | `bash evidence/verify-fb.sh FB-06` | [x] |
| FB-07 | `POST /store/reservations` | booking + station | booking allocation | booking form | + station | double booking | `bash evidence/verify-fb.sh FB-07` | [x] |
| FB-08 | `POST /ecommerce/reservations/hold` | hold + station | held allocation | storefront | + station | lost hold | `bash evidence/verify-fb.sh FB-08` | [x] |
| FB-09 | `POST /ecommerce/reservations/:id/confirm-hold` | booking id | confirmed allocation | storefront | station invariant | double confirm | `bash evidence/verify-fb.sh FB-09` | [x] |
| FB-10 | `PATCH /store/reservations/:id/reschedule` | reschedule | booking + allocation | calendar | station reassignment | orphan slot | `bash evidence/verify-fb.sh FB-10` | [x] |
| FB-11 | `PUT /store/orders/:id/editor` | booking + service lines | order + booking | POS/editor | guard budget and station | bypass | `bash evidence/verify-fb.sh FB-11` | [x] |
| FB-12 | `POST /ecommerce/checkout` | cart + booking | order and booking | checkout | atomic booking result | paid no slot | `bash evidence/verify-fb.sh FB-12` | [x] |
| FB-13 | `POST /store/service-sessions` | open session DTO | session/order/token status | station board | new open | duplicate active | `bash evidence/verify-fb.sh FB-13` | [x] |
| FB-14 | `PATCH /store/service-sessions/:id` | progress/close | session events | station board | new lifecycle | wrong status | `bash evidence/verify-fb.sh FB-14` | [x] |
| FB-15 | `GET /store/service-sessions/:id/stream` | SSE auth | session events | staff board | new SSE | cross-store event | `bash evidence/verify-fb.sh FB-15` | [x] |
| FB-16 | `GET /ecommerce/service-sessions/:token` | capability token | progress, approved totals, proposal breakdown | storefront | new private page | data leak | `bash evidence/verify-fb.sh FB-16` | [x] |
| FB-17 | `GET /ecommerce/service-sessions/:token/stream` | capability token | safe SSE frames | storefront | new SSE | cross-session leak | `bash evidence/verify-fb.sh FB-17` | [x] |
| FB-18 | `POST /store/service-sessions/:id/proposals` | versioned lines | pending proposal | order detail | new change request | hidden charge | `bash evidence/verify-fb.sh FB-18` | [x] |
| FB-19 | `POST /ecommerce/service-proposals/:token/decision` | one-time decision + proposal version | approved/rejected | customer view | new consent | stale approval | `bash evidence/verify-fb.sh FB-19` | [x] |
| FB-20 | `GET /store/service-sessions/:id/proposals` | session id | proposal history | order detail | new audit | missing decision | `bash evidence/verify-fb.sh FB-20` | [x] |
| FB-21 | `POST /store/service-sessions/:id/contact` | channel/template | delivery status | order detail | new customer contact | duplicate send | `bash evidence/verify-fb.sh FB-21` | [x] |
| FB-22 | `GET /store/reservations/calendar` | bounded date range + page | bookings + stations | calendar | + station status | wrong board | `bash evidence/verify-fb.sh FB-22` | [x] |
| FB-23 | `PATCH /store/products/:id` | service requires_station | product response | product form | + requires_station | missing capacity rule | `bash evidence/verify-fb.sh FB-23` | [x] |
| FB-24 | `POST /store/table-sessions/:id/add-items` | line mutation | order totals | restaurant POS | budget guard regression | bypass | `bash evidence/verify-fb.sh FB-24` | [x] |
| FB-25 | `POST /store/payments` | payment/order lines | paid order | POS payment | budget guard regression | bypass | `bash evidence/verify-fb.sh FB-25` | [x] |
| FB-26 | `POST /store/service-sessions/:id/access/reissue` | verified contact | new delivery state | order detail | token rotation | takeover | `bash evidence/verify-fb.sh FB-26` | [x] |
| FB-27 | `GET /ecommerce/reservations/availability/:productId` | service and date | station slots | storefront booking | + station | wrong slot | `bash evidence/verify-fb.sh FB-27` | [x] |
| FB-28 | `GET /ecommerce/reservations/availability-overview/:productId` | month | days/capacity | storefront calendar | + station | false capacity | `bash evidence/verify-fb.sh FB-28` | [x] |
| FB-29 | `POST /ecommerce/reservations` | booking/station | booking+allocation | storefront booking | + station | conflict | `bash evidence/verify-fb.sh FB-29` | [x] |
| FB-30 | `POST /ecommerce/reservations/:id/cancel` | booking id | released interval | customer booking | release | orphan | `bash evidence/verify-fb.sh FB-30` | [x] |
| FB-31 | `POST /ecommerce/reservations/:id/reschedule` | requested interval | pending change | customer booking | reassign | orphan | `bash evidence/verify-fb.sh FB-31` | [x] |
| FB-32 | `POST /ecommerce/reservations/:id/check-in` | booking id | check-in | customer booking | station verify | wrong station | `bash evidence/verify-fb.sh FB-32` | [x] |
| FB-33 | `GET /store/reservations/confirm/:token` | confirm token | confirmed or 409 | email link | enforce station | double booking | `bash evidence/verify-fb.sh FB-33` | [x] |
| FB-34 | `PATCH /store/reservations/:id/confirm` | booking id | confirmed allocation | admin booking | enforce station | double booking | `bash evidence/verify-fb.sh FB-34` | [x] |
| FB-35 | `PATCH /store/reservations/:id/start` | booking id | started allocation | admin booking | station occupied | double open | `bash evidence/verify-fb.sh FB-35` | [x] |
| FB-36 | `PATCH /store/reservations/:id/cancel` | booking id | released allocation | admin booking | release | orphan | `bash evidence/verify-fb.sh FB-36` | [x] |
| FB-37 | `PATCH /store/reservations/:id/complete` | booking id | released allocation | admin booking | release | orphan | `bash evidence/verify-fb.sh FB-37` | [x] |
| FB-38 | `PATCH /store/reservations/:id/no-show` | booking id | released allocation | admin booking | release | orphan | `bash evidence/verify-fb.sh FB-38` | [x] |
| FB-39 | `PATCH /store/reservations/:id/check-in` | booking id | checked in | admin booking | station verify | wrong station | `bash evidence/verify-fb.sh FB-39` | [x] |
| FB-40 | `DELETE /store/reservations/:id` | booking id | deleted/released | admin booking | transactional release | orphan | `bash evidence/verify-fb.sh FB-40` | [x] |
| FB-41 | `PATCH /store/reservations/reschedule-requests/:reqId/approve` | request id | new allocation | admin request | reassign | double booking | `bash evidence/verify-fb.sh FB-41` | [x] |
| FB-42 | `POST /store/orders` | order lines | order total | POS create | budget guard | bypass | `bash evidence/verify-fb.sh FB-42` | [x] |
| FB-43 | `PUT /store/orders/:id/items` | order lines | order total | order detail | budget guard | bypass | `bash evidence/verify-fb.sh FB-43` | [x] |
| FB-44 | `PATCH /store/reservations/:id` | booking update | booking allocation | admin booking | guard changes | orphan | `bash evidence/verify-fb.sh FB-44` | [x] |
| FB-45 | `PATCH /store/reservations/:id/mark-attending` | booking id | attending | admin queue | occupancy sync | wrong state | `bash evidence/verify-fb.sh FB-45` | [x] |
| FB-46 | `PATCH /store/reservations/:id/mark-arriving` | booking id | arriving | admin queue | occupancy sync | wrong state | `bash evidence/verify-fb.sh FB-46` | [x] |
| FB-47 | `POST /store/payments/with-order` | payment with lines | paid order | POS | budget guard | bypass | `bash evidence/verify-fb.sh FB-47` | [x] |
| FB-48 | `POST /store/payments/pos` | POS payment | paid order | POS | budget guard | bypass | `bash evidence/verify-fb.sh FB-48` | [x] |
