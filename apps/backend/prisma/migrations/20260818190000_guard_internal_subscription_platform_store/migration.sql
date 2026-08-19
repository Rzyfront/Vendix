-- DATA IMPACT:
-- Tables affected: store_subscriptions
-- Expected row changes: 0 a 2 (sólo si la fila actual está en 'active' con
--   plan_id NULL pero con started_at/current_period_start/next_billing_at
--   null — completa los campos que la migración anterior dejó vacíos).
-- Destructive operations: ninguna si la pre-condición no se cumple.
-- FK/cascade risk: ninguno.
-- Idempotency: el WHERE hace la migración no-op si la fila ya tiene
--   started_at NO null. El timestamp se reemplaza por un literal fijo
--   (regla del feedback: NOW() no-determinista entre ejecuciones).
-- Approval: plan crítico docs/plans/facturacion-plataforma-puente-y-paridad.md
--   (CP-fiscal-puente-plataforma), ADR-1, F4.1/F4.2/F4.3 del convergence round 1.

-- Por si la migración previa (20260818181000) NO corrió todavía: la
-- variante completa con WHERE de zombie. En ese caso la fila actual está
-- en 'suspended' con plan_id=2, y la pasamos a la forma sintética.
INSERT INTO store_subscriptions (
  store_id,
  plan_id,
  state,
  started_at,
  current_period_start,
  current_period_end,
  next_billing_at,
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
    NOW(),
    NOW(),
    TIMESTAMP '2126-08-18 00:00:00',
    TIMESTAMP '2126-08-18 00:00:00',
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
    NOW(),
    NOW(),
    TIMESTAMP '2126-08-18 00:00:00',
    TIMESTAMP '2126-08-18 00:00:00',
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
    started_at = EXCLUDED.started_at,
    current_period_start = EXCLUDED.current_period_start,
    current_period_end = EXCLUDED.current_period_end,
    next_billing_at = EXCLUDED.next_billing_at,
    currency = EXCLUDED.currency,
    effective_price = EXCLUDED.effective_price,
    vendix_base_price = EXCLUDED.vendix_base_price,
    partner_margin_amount = EXCLUDED.partner_margin_amount,
    auto_renew = EXCLUDED.auto_renew,
    resolved_features = EXCLUDED.resolved_features,
    updated_at = NOW()
  WHERE store_subscriptions.state = 'suspended'
    AND store_subscriptions.plan_id = 2;

-- Si la migración previa (20260818181000) YA corrió: las filas ya están
-- en 'active' con plan_id=NULL pero sin started_at/current_period_start
-- /next_billing_at. Esta segunda parte rellena esos campos. La pre-condición
-- es: la fila ya está en la forma sintética, pero con timestamps null
-- o con current_period_end no determinista (proveniente de NOW()).
-- Si los timestamps ya están al valor fijo, es no-op.
UPDATE store_subscriptions
  SET
    started_at = COALESCE(started_at, NOW()),
    current_period_start = COALESCE(current_period_start, NOW()),
    current_period_end = CASE
      WHEN current_period_end = TIMESTAMP '2126-08-18 00:00:00'
        THEN current_period_end
      ELSE TIMESTAMP '2126-08-18 00:00:00'
    END,
    next_billing_at = CASE
      WHEN next_billing_at = TIMESTAMP '2126-08-18 00:00:00'
        THEN next_billing_at
      ELSE TIMESTAMP '2126-08-18 00:00:00'
    END,
    updated_at = NOW()
  WHERE store_id IN (1, 2)
    AND state = 'active'
    AND plan_id IS NULL;
