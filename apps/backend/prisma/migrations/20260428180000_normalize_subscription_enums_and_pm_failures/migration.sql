-- =============================================================================
-- DATA IMPACT
-- -----------------------------------------------------------------------------
-- Tables affected (schema-only, no row deletes / no truncates):
--   * partner_payout_batches              -> ALTER COLUMN state (varchar -> enum)
--   * subscription_payment_methods        -> ALTER COLUMN state (varchar -> enum)
--                                            + ADD COLUMN consecutive_failures
--                                            + ADD COLUMN replaced_by_id (FK self)
--                                            + ADD COLUMN replaced_at
--   * subscription_event_type_enum        -> ADD VALUE 'scheduled_cancel'
--
-- Tables created:
--   * partner_payout_batch_state_enum            (new enum)
--   * subscription_payment_method_state_enum     (new enum)
--
-- Existing rows preserved:
--   * partner_payout_batches: rows kept; column is converted in place via USING.
--     Pre-flight check ABORTS migration if any state value is outside
--     {draft, approved, sent, paid, rejected}.
--   * subscription_payment_methods: rows kept; column is converted in place via USING.
--     Pre-flight check ABORTS migration if any state value is outside
--     {active, invalid, removed, replaced}.
--
-- Defaults:
--   * partner_payout_batches.state          -> 'draft'  (no prior default)
--   * subscription_payment_methods.state    -> 'active' (matches prior text default)
--   * subscription_payment_methods.consecutive_failures -> 0
--
-- Cascade risk check:
--   * No DROP TABLE, no TRUNCATE, no CASCADE, no unscoped DELETE/UPDATE.
--   * No inbound FKs into partner_payout_batches.state or
--     subscription_payment_methods.state are dropped (only column type changes).
--   * New self-FK on subscription_payment_methods.replaced_by_id uses
--     ON DELETE SET NULL (preserves history rows).
--
-- Idempotency: every block is gated by IF NOT EXISTS / pg_type / pg_enum / pg_attribute
-- checks so the migration is safe to retry.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Add 'scheduled_cancel' to subscription_event_type_enum
--    ALTER TYPE ... ADD VALUE must run OUTSIDE a transaction.
--    Postgres 12+: IF NOT EXISTS makes it idempotent.
-- -----------------------------------------------------------------------------
ALTER TYPE "subscription_event_type_enum" ADD VALUE IF NOT EXISTS 'scheduled_cancel';

-- -----------------------------------------------------------------------------
-- 2) Create partner_payout_batch_state_enum (idempotent)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'partner_payout_batch_state_enum') THEN
    CREATE TYPE "partner_payout_batch_state_enum"
      AS ENUM ('draft', 'approved', 'sent', 'paid', 'rejected');
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 3) Create subscription_payment_method_state_enum (idempotent)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_payment_method_state_enum') THEN
    CREATE TYPE "subscription_payment_method_state_enum"
      AS ENUM ('active', 'invalid', 'removed', 'replaced');
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 4) Pre-flight validation: partner_payout_batches.state values
--    Aborts migration with clear error if any row holds a value outside the
--    new enum. Skipped if the column is already converted to the enum type.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_bad_value text;
  v_col_type  text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO v_col_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  WHERE c.relname = 'partner_payout_batches'
    AND a.attname = 'state'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_col_type IS NULL THEN
    RAISE NOTICE 'partner_payout_batches.state column missing — skipping validation';
    RETURN;
  END IF;

  IF v_col_type LIKE '%partner_payout_batch_state_enum%' THEN
    RAISE NOTICE 'partner_payout_batches.state already converted to enum — skipping validation';
    RETURN;
  END IF;

  SELECT DISTINCT state
    INTO v_bad_value
  FROM partner_payout_batches
  WHERE state IS NOT NULL
    AND state NOT IN ('draft', 'approved', 'sent', 'paid', 'rejected')
  LIMIT 1;

  IF v_bad_value IS NOT NULL THEN
    RAISE EXCEPTION
      'ABORT: partner_payout_batches.state contains value % which is not in partner_payout_batch_state_enum (draft|approved|sent|paid|rejected). Resolve data before applying migration.',
      v_bad_value;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 5) Pre-flight validation: subscription_payment_methods.state values
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_bad_value text;
  v_col_type  text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO v_col_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  WHERE c.relname = 'subscription_payment_methods'
    AND a.attname = 'state'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_col_type IS NULL THEN
    RAISE NOTICE 'subscription_payment_methods.state column missing — skipping validation';
    RETURN;
  END IF;

  IF v_col_type LIKE '%subscription_payment_method_state_enum%' THEN
    RAISE NOTICE 'subscription_payment_methods.state already converted to enum — skipping validation';
    RETURN;
  END IF;

  SELECT DISTINCT state
    INTO v_bad_value
  FROM subscription_payment_methods
  WHERE state IS NOT NULL
    AND state NOT IN ('active', 'invalid', 'removed', 'replaced')
  LIMIT 1;

  IF v_bad_value IS NOT NULL THEN
    RAISE EXCEPTION
      'ABORT: subscription_payment_methods.state contains value % which is not in subscription_payment_method_state_enum (active|invalid|removed|replaced). Resolve data before applying migration.',
      v_bad_value;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 6) Convert partner_payout_batches.state to enum (idempotent via DO check)
--    Uses USING to cast existing varchar values into the new enum.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_col_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO v_col_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  WHERE c.relname = 'partner_payout_batches'
    AND a.attname = 'state'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_col_type LIKE '%partner_payout_batch_state_enum%' THEN
    RAISE NOTICE 'partner_payout_batches.state already enum — skipping ALTER';
  ELSE
    -- Drop existing default (text) before changing type
    EXECUTE 'ALTER TABLE "partner_payout_batches" ALTER COLUMN "state" DROP DEFAULT';
    EXECUTE 'ALTER TABLE "partner_payout_batches" '
         || 'ALTER COLUMN "state" TYPE "partner_payout_batch_state_enum" '
         || 'USING ("state"::text::"partner_payout_batch_state_enum")';
    EXECUTE 'ALTER TABLE "partner_payout_batches" '
         || 'ALTER COLUMN "state" SET DEFAULT ''draft''::"partner_payout_batch_state_enum"';
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 7) Convert subscription_payment_methods.state to enum (idempotent)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_col_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO v_col_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  WHERE c.relname = 'subscription_payment_methods'
    AND a.attname = 'state'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_col_type LIKE '%subscription_payment_method_state_enum%' THEN
    RAISE NOTICE 'subscription_payment_methods.state already enum — skipping ALTER';
  ELSE
    EXECUTE 'ALTER TABLE "subscription_payment_methods" ALTER COLUMN "state" DROP DEFAULT';
    EXECUTE 'ALTER TABLE "subscription_payment_methods" '
         || 'ALTER COLUMN "state" TYPE "subscription_payment_method_state_enum" '
         || 'USING ("state"::text::"subscription_payment_method_state_enum")';
    EXECUTE 'ALTER TABLE "subscription_payment_methods" '
         || 'ALTER COLUMN "state" SET DEFAULT ''active''::"subscription_payment_method_state_enum"';
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 8) Add new columns on subscription_payment_methods
--    consecutive_failures: counts consecutive payment failures with this PM;
--                          resets to 0 after a successful charge.
--    replaced_by_id      : self-FK pointing to the new PM that supersedes this
--                          one (used when a card is reissued / re-tokenized).
--                          ON DELETE SET NULL — never cascade-delete history.
--    replaced_at         : timestamp when this PM was marked 'replaced'.
-- -----------------------------------------------------------------------------
ALTER TABLE "subscription_payment_methods"
  ADD COLUMN IF NOT EXISTS "consecutive_failures" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "subscription_payment_methods"
  ADD COLUMN IF NOT EXISTS "replaced_by_id" INTEGER;

ALTER TABLE "subscription_payment_methods"
  ADD COLUMN IF NOT EXISTS "replaced_at" TIMESTAMP(3);

-- Self-FK (idempotent: only add if not present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscription_payment_methods_replaced_by_id_fkey'
  ) THEN
    ALTER TABLE "subscription_payment_methods"
      ADD CONSTRAINT "subscription_payment_methods_replaced_by_id_fkey"
      FOREIGN KEY ("replaced_by_id")
      REFERENCES "subscription_payment_methods"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- Index to look up replacements (small table; cheap)
CREATE INDEX IF NOT EXISTS "subscription_payment_methods_replaced_by_id_idx"
  ON "subscription_payment_methods"("replaced_by_id");

-- -----------------------------------------------------------------------------
-- 9) Documentation comments
-- -----------------------------------------------------------------------------
COMMENT ON COLUMN "subscription_payments"."state" IS
  'Estados refunded/partial_refund existen para chargeback bancario externo (forzado por Wompi); Vendix NO procesa reembolsos como politica.';

COMMENT ON COLUMN "subscription_payment_methods"."consecutive_failures" IS
  'Numero de fallos de cobro consecutivos con este metodo. Se reinicia a 0 tras un cobro exitoso. Cuando supera el umbral, el sistema marca la PM como invalid.';

COMMENT ON COLUMN "subscription_payment_methods"."replaced_by_id" IS
  'FK self-reference al nuevo PM que reemplaza a este (re-tokenizacion / nueva tarjeta). Combinado con state=replaced preserva el historial.';

COMMENT ON COLUMN "subscription_payment_methods"."replaced_at" IS
  'Timestamp del momento en que esta PM fue marcada como replaced.';

COMMENT ON TYPE "partner_payout_batch_state_enum" IS
  'Estados del payout batch: draft (recien creado, agregando comisiones) -> approved (revisado por superadmin) -> sent (despachado al banco) -> paid (confirmado). rejected es terminal manual.';

COMMENT ON TYPE "subscription_payment_method_state_enum" IS
  'Estados del PM: active (utilizable) | invalid (rechazado por gateway / expirado) | removed (eliminado por el usuario, soft-delete) | replaced (sustituido por otra PM, conserva historial via replaced_by_id).';
