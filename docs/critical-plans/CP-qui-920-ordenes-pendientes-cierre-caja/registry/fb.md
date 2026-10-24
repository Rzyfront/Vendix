# Frontend↔Backend Contract Registry
| Id | Method + route | Request DTO | Response shape | Frontend consumer | Change | Risk | Verification | Status |
|----|----------------|-------------|----------------|-------------------|--------|------|--------------|--------|
| FB-01 | `GET /store/cash-registers/sessions/active` | JWT | active session | web+mobile POS | regression | wrong active | `bash evidence/verify-fb.sh FB-01` | [ ] |
| FB-02 | `GET /store/cash-registers/sessions/:id/cash-summary` | session id | cash totals | web close modal | regression | wrong expected | `bash evidence/verify-fb.sh FB-02` | [ ] |
| FB-03 | `GET /store/cash-registers/sessions/:id/close-report` | session id | frozen pending snapshot + totals | report/detail | + pending snapshot | live history | `bash evidence/verify-fb.sh FB-03` | [ ] |
| FB-04 | `GET /store/cash-registers/sessions/:id/pending-orders` | page,limit | count,reason,rows,fingerprint | web+mobile close | new scoped list | missing draft | `bash evidence/verify-fb.sh FB-04` | [ ] |
| FB-05 | `POST /store/cash-registers/sessions/:id/close` | CloseSessionDto + pending_decision/fingerprint/reason | closed summary | web+mobile close | new guard | silent override | `bash evidence/verify-fb.sh FB-05` | [ ] |
| FB-06 | `POST /store/cash-registers/sessions/open` | OpenSessionDto | open session | web+mobile POS | regression | wrong session | `bash evidence/verify-fb.sh FB-06` | [ ] |
| FB-07 | `POST /store/orders` | order draft DTO | order origin session | admin/POS | + origin link | unattributed | `bash evidence/verify-fb.sh FB-07` | [ ] |
| FB-08 | `PUT /store/orders/:id/editor` | order editor DTO | order unchanged origin | POS editor | regression | reassignment | `bash evidence/verify-fb.sh FB-08` | [ ] |
| FB-09 | `POST /store/payments/pos` | POS payment DTO | order/payment/movement | web+mobile POS | origin link on create | misattributed | `bash evidence/verify-fb.sh FB-09` | [ ] |
| FB-10 | `GET /store/orders/:id` | id | order details | pending row link | regression | wrong route | `bash evidence/verify-fb.sh FB-10` | [ ] |
| FB-11 | `POST /store/orders/bulk/cash-session-preview` | IDs ≤ cap | eligibility + effects + fingerprint | web+mobile batch | new preview | false eligible | `bash evidence/verify-fb.sh FB-11` | [ ] |
| FB-12 | `POST /store/orders/bulk/cash-session-finish` | IDs + fingerprint | all-or-none result | web+mobile batch | new atomic flow | partial commit | `bash evidence/verify-fb.sh FB-12` | [ ] |
| FB-13 | `POST /store/orders/bulk/transition` | ids,targetState | per-row result | general orders bulk | regression only | forced bypass | `bash evidence/verify-fb.sh FB-13` | [ ] |
| FB-14 | `POST /store/orders/bulk/transition/preview` | ids,targetState | warnings/errors | general orders bulk | regression only | misleading preview | `bash evidence/verify-fb.sh FB-14` | [ ] |
| FB-15 | `GET /store/cash-registers/sessions/:id` | id | session + summary | admin detail | regression | stale detail | `bash evidence/verify-fb.sh FB-15` | [ ] |
| FB-16 | `GET /store/cash-registers/sessions/:id/movements` | id | cash movements | mobile POS/report | regression | missing sale | `bash evidence/verify-fb.sh FB-16` | [ ] |
| FB-17 | `POST /store/cash-registers/sessions/:id/movements` | manual movement DTO | movement + cash summary | cash admin | shared close lock | lost movement | `bash evidence/verify-fb.sh FB-17` | [ ] |
| FB-18 | `POST /store/payments/with-order` | payment/order DTO | payment + movement | POS | shared close lock | paid without movement | `bash evidence/verify-fb.sh FB-18` | [ ] |
