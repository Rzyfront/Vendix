-- DATA IMPACT:
-- Tables affected: store_subscriptions, subscription_events
-- Expected row changes: up to 5 store_subscriptions rows (id 23, 36, 58, 66, 72;
--   plan_id 14 TRIALEXTEND free promo) go state active -> expired; subscription_events
--   gets +1 'state_transition' row per affected subscription (max 5).
-- Destructive operations: none (no DELETE, no CASCADE, no schema change)
-- FK/cascade risk: none (subscription_events.store_subscription_id references existing rows)
-- Idempotency: guarded by id/plan_id/state = 'active' in WHERE; re-run affects 0 rows
-- Cache: Redis sub:features:{storeId} expires by itself (TTL 60 s)
-- Approval: authorized explicitly by the owner in chat on 2026-10-04 ("Cortar ya")

WITH cut AS (
  UPDATE store_subscriptions
     SET state = 'expired'::store_subscription_state_enum, updated_at = now()
   WHERE id IN (23, 36, 58, 66, 72)
     AND plan_id = 14
     AND state = 'active'::store_subscription_state_enum
  RETURNING id, current_period_end
)
INSERT INTO subscription_events
  (store_subscription_id, type, from_state, to_state, payload, triggered_by_job, created_at)
SELECT id,
       'state_transition'::subscription_event_type_enum,
       'active'::store_subscription_state_enum,
       'expired'::store_subscription_state_enum,
       jsonb_build_object('reason', 'free_promo_self_renewed_cutoff', 'plan_id', 14, 'current_period_end', current_period_end),
       'migration:20261004120000_expire_free_promo_self_renewed',
       now()
  FROM cut;
