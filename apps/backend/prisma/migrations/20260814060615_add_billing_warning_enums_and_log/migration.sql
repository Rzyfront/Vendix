-- =============================================================================
-- DATA IMPACT
-- -----------------------------------------------------------------------------
-- Tables affected (schema-only, no row deletes / no truncates):
--   * subscription_event_type_enum    -> ADD VALUE 3x
--                                         (auto_renew_disabled_no_credential,
--                                          renewal_failed,
--                                          payment_method_expiring)
--   * notification_type_enum          -> ADD VALUE 2x
--                                         (auto_renew_disabled_no_credential,
--                                          auto_renew_charge_failed)
--
-- Tables created:
--   * billing_warning_logs            -> new dedupe table for billing-warning
--                                         notifications + emails.
--                                         Unique index on (store_id, type,
--                                         source_event_id) so a retry collapses
--                                         to a single row per warning source.
--                                         period_id is informational only
--                                         (NULL for the no-credential case).
--
-- Existing rows preserved:
--   * No row deletes / no truncates / no unscoped updates.
--   * Enum value additions are APPEND-ONLY at the end of the enum list so
--     existing rows keep their ordinal values and any deployed clients that
--     already bound to the enum by ordinal remain valid.
--
-- Defaults:
--   * billing_warning_logs.created_at -> now()
--
-- Cascade risk check:
--   * No DROP TABLE, no TRUNCATE, no CASCADE, no unscoped DELETE/UPDATE.
--   * No inbound FKs into billing_warning_logs are dropped.
--
-- Idempotency: every block is gated by IF NOT EXISTS / pg_type / pg_enum checks
-- so the migration is safe to retry.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Extend subscription_event_type_enum (3 new values).
--    ALTER TYPE ... ADD VALUE must run OUTSIDE a transaction in PG <12, but
--    PG 12+ supports IF NOT EXISTS inside a transaction block when no other
--    statement in the block uses the new value. Mirror the existing pattern
--    from 20260428180000_normalize_subscription_enums_and_pm_failures.
-- -----------------------------------------------------------------------------
ALTER TYPE "subscription_event_type_enum" ADD VALUE IF NOT EXISTS 'auto_renew_disabled_no_credential';
ALTER TYPE "subscription_event_type_enum" ADD VALUE IF NOT EXISTS 'renewal_failed';
ALTER TYPE "subscription_event_type_enum" ADD VALUE IF NOT EXISTS 'payment_method_expiring';

-- -----------------------------------------------------------------------------
-- 2) Extend notification_type_enum (2 new values).
-- -----------------------------------------------------------------------------
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'auto_renew_disabled_no_credential';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'auto_renew_charge_failed';

-- -----------------------------------------------------------------------------
-- 3) Create billing_warning_logs (idempotent).
--    Dedupe primitive mirrors webhook_event_dedup. Unique on
--    (store_id, type, source_event_id); period_id is informational only.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "billing_warning_logs" (
  "id"              SERIAL          PRIMARY KEY,
  "store_id"        INTEGER         NOT NULL,
  "type"            VARCHAR(64)     NOT NULL,
  "period_id"       INTEGER,
  "source_event_id" INTEGER         NOT NULL,
  "created_at"      TIMESTAMP(6)    NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_warning_logs_dedupe_uq"
  ON "billing_warning_logs" ("store_id", "type", "source_event_id");

CREATE INDEX IF NOT EXISTS "billing_warning_logs_store_type_idx"
  ON "billing_warning_logs" ("store_id", "type", "created_at");
