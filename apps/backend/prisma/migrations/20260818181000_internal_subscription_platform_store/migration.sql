-- DATA IMPACT:
-- Tables affected: store_subscriptions
-- Expected row changes: 2 row rewrites (store_id 1 and 2)
--   - Pre-condition: las tiendas 1 y 2 tienen fila en store_subscriptions con
--     state='suspended', plan_id=2, current_period_end=2026-07-14 (ZOMBIES).
--     El ON CONFLICT DO NOTHING las dejaba en 'suspended' y StoreOperationsGuard
--     seguía bloqueando. El plan crítico A.1 (ADR-1) representa la oferta
--     operativa con state='active' y plan_id=NULL.
--   - Destructive: REESCRIBE 2 filas. No borra ni trunca.
--   - FK/cascade risk: ninguno (store_id apunta a stores existentes; sin CASCADE).
-- Idempotency: ON CONFLICT (store_id) DO UPDATE — re-ejecutable sin cambio.
-- Approval: plan crítico docs/plans/facturacion-plataforma-puente-y-paridad.md
--   (CP-fiscal-puente-plataforma), ADR-1.
-- Note: la fila sintética interna NO se cobra a sí misma. El guard sigue
--   con UNA sola regla (mode='active'); el resto de las 12 tiendas tenant no
--   se ven afectadas.

INSERT INTO store_subscriptions (
  store_id,
  plan_id,
  state,
  current_period_end,
  currency,
  effective_price,
  vendix_base_price,
  partner_margin_amount,
  auto_renew,
  resolved_features,
  resolved_at,
  created_at,
  updated_at
)
VALUES
  (
    1,
    NULL,
    'active',
    NOW() + INTERVAL '100 years',
    'COP',
    0,
    0,
    0,
    false,
    '{}'::json,
    NOW(),
    NOW(),
    NOW()
  ),
  (
    2,
    NULL,
    'active',
    NOW() + INTERVAL '100 years',
    'COP',
    0,
    0,
    0,
    false,
    '{}'::json,
    NOW(),
    NOW(),
    NOW()
  )
ON CONFLICT (store_id) DO UPDATE
  SET
    state = EXCLUDED.state,
    plan_id = EXCLUDED.plan_id,
    current_period_end = EXCLUDED.current_period_end,
    currency = EXCLUDED.currency,
    effective_price = EXCLUDED.effective_price,
    vendix_base_price = EXCLUDED.vendix_base_price,
    partner_margin_amount = EXCLUDED.partner_margin_amount,
    auto_renew = EXCLUDED.auto_renew,
    resolved_features = EXCLUDED.resolved_features,
    updated_at = NOW();
