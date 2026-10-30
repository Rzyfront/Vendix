# D.1 — Database Exclusion & Migration Validation

- **Worktree:** `/tmp/Vendix-service-stations-qr` (`feature/service-stations-reservas-qr-budget`)
- **Database:** `vendix_stations_test` (cloned with live schema/data from `vendix_db`, 11 stores)
- **Migrations Applied:**
  - `20261011120000_service_stations_reservations`
  - `20261011140000_station_reschedule_requests`
  - `20261012140000_service_session_email_delivery`
  - `20261012160000_service_session_delivery_token_scope`
  - `20261013090000_service_email_failure_notification`
  - `20261013100000_service_proposal_decision_challenges`
  - `20261013120000_checkout_reconciliation_notification_type`
- **Result:** ALL 7 migrations applied cleanly with exit code 0.

## Exclusion Constraint Verification (DB-04, DB-05, DB-06, DB-20, ERR-01, ERR-02)
- Tested `service_allocations_station_no_overlap` under overlapping time ranges `[10:00, 11:00)` and `[10:30, 11:30)` on the same station.
- **Outcome:** PostgreSQL threw `exclusion_violation` (SQLSTATE `23P01`), preventing double-booking at the database engine level.
- Tested `service_sessions_one_active_per_station_uq` unique constraint.
- **Outcome:** Rejects duplicate active sessions on the same station with `unique_violation` (SQLSTATE `23505`).
