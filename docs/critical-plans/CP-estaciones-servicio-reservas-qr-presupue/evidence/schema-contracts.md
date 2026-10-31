# Binding schema contracts for A.2

These decisions close fields and invariants left implicit in DB-01..DB-20. They are part of the approved execution scope.

## Time and allocation

- Allocation intervals use UTC `timestamptz`, half-open `[start_at,end_at)`, with `start_at < end_at`.
- Allocation states are `held`, `payment_pending`, `confirmed`, `in_service`, `released`, `expired`, and `cancelled`. The exclusion constraint applies to the first four states. A reaper transitions timed-out holds to `expired`; availability ignores rows after that transition. `expires_at` is not used in a partial-index predicate.
- A `held` allocation has a deadline; `payment_pending` holds payment-gateway reservations for 30 minutes; confirmed and in-service allocations do not expire automatically.
- Station schedules are weekly local-clock blocks (`weekday`, `start_time`, `end_time`) in the station's IANA `time_zone`, copied from the store when the station is created. Blocks stay within one local day, may repeat on a weekday, and may not overlap.
- Station exceptions are UTC instants and use half-open ranges. Local times in a DST gap are rejected. Ambiguous local times require an explicit UTC offset in the booking request.

## Tenant and ownership integrity

- Every new tenant-owned relation has `store_id`; composite foreign keys enforce store equality for station/service, station/provider, allocation/booking, session/station and session/order. Provider-service compatibility is checked through the provider and product ownership rows.
- An allocation has exactly one owner (`booking_id XOR session_id`). A session can link to at most one booking and one order. `service_sessions.order_id` is unique when present.
- Existing booking history is not rewritten in A.2. Future legacy bookings are reconciled before enabling `requires_station` for a store; conflicts block activation.
- Foreign keys to retained audit actors use nullable references with `ON DELETE SET NULL`. Stations, services, providers, and sessions cannot be deleted while active allocations or retained sessions depend on them.

## Status and audit contracts

- Station status: `active`, `inactive`, `maintenance`. Only active stations can be newly assigned.
- Session status: `open`, `paused`, `closed`, `cancelled`. `open` and `paused` are active for station uniqueness; both retain the station until closure/cancellation releases the allocation.
- Proposal status: `pending`, `approved`, `rejected`, `expired`, `superseded`, `applied`. At most one pending proposal exists per session. Approval is for one immutable proposal and one order version; application is idempotent.
- Subject kinds are `vehicle`, `person`, `equipment`, `other`; subject metadata is JSONB and stores only fields required for the service.
- Public station IDs and session-token hashes are unique. Only SHA-256 hashes of random session tokens are stored. Progress events are append-only and have a monotonic per-session sequence.
- One budget exists per session. Monetary values use `Decimal(12,2)` with ISO 4217 currency. Proposal line, tax, discount, currency and total snapshots are immutable JSONB/decimal values protected by a SHA-256 digest. Decisions are unique per proposal; contact idempotency keys are unique per store/session.

## Migration and scope

- Migration is additive, includes a `-- DATA IMPACT:` header, adds `btree_gist`, and enforces station and provider overlap with `EXCLUDE USING gist` on `tstzrange(start_at,end_at,'[)')` for occupying states.
- Cross-store compound keys are added only where required for new composite FKs. No production migration or data rewrite is performed as part of schema authoring.
- Prisma model registrations must include the new store-owned models in both `StorePrismaService` and `EcommercePrismaService` according to their respective scoped-model patterns.