-- DATA IMPACT:
--   EXTENSION: instala pgcrypto si no existe (idempotente, requerida por gen_random_bytes())
--   ENUMs: añade 9 valores a domain_status_enum (no destructivo)
--   COLUMNS: añade 8 columnas a domain_settings, 2 a organizations (todas nullable o con default)
--   TABLE: crea domain_blocklist (nueva)
--   INDEX: crea partial unique index hostname_active (drop+create idempotente)
--   UPDATES: backfill verification_token (solo NULL), map legacy pending_dns → pending_ownership (filtrado por ownership), expires_token_at (solo NULL)
--   SEED: 12 entries en domain_blocklist (ON CONFLICT DO NOTHING)
-- DESTRUCTIVE: NONE — sin TRUNCATE, sin DROP TABLE, sin DELETE/UPDATE sin WHERE
-- IDEMPOTENT: SI — IF NOT EXISTS en todo, ON CONFLICT DO NOTHING en seed

-- Required extension. Self-declared aquí (en lugar de en una migración inicial
-- que prod ya aplicó) porque esta migración es la primera del repo en usar
-- gen_random_bytes(). Idempotente: noop si ya está instalada.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 7.1 Nuevos valores de enum (idempotente)
ALTER TYPE "domain_status_enum" ADD VALUE IF NOT EXISTS 'pending_ownership';
ALTER TYPE "domain_status_enum" ADD VALUE IF NOT EXISTS 'verifying_ownership';
ALTER TYPE "domain_status_enum" ADD VALUE IF NOT EXISTS 'pending_certificate';
ALTER TYPE "domain_status_enum" ADD VALUE IF NOT EXISTS 'issuing_certificate';
ALTER TYPE "domain_status_enum" ADD VALUE IF NOT EXISTS 'pending_alias';
ALTER TYPE "domain_status_enum" ADD VALUE IF NOT EXISTS 'propagating';
ALTER TYPE "domain_status_enum" ADD VALUE IF NOT EXISTS 'failed_ownership';
ALTER TYPE "domain_status_enum" ADD VALUE IF NOT EXISTS 'failed_certificate';
ALTER TYPE "domain_status_enum" ADD VALUE IF NOT EXISTS 'failed_alias';

-- 7.2 Columnas en domain_settings
ALTER TABLE "domain_settings"
  ADD COLUMN IF NOT EXISTS "validation_cname_name"      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "validation_cname_value"     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "validation_dns_missing_at"  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "cert_expires_at"            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "cloudfront_snapshot_before" JSONB,
  ADD COLUMN IF NOT EXISTS "last_error_code"            VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "retry_count"                INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "expires_token_at"           TIMESTAMPTZ;

-- 7.3 Columnas en organizations (cert por org)
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "acm_certificate_arn" VARCHAR(2048),
  ADD COLUMN IF NOT EXISTS "acm_cert_revision"   INT NOT NULL DEFAULT 0;

-- 7.4 Tabla domain_blocklist
CREATE TABLE IF NOT EXISTS "domain_blocklist" (
  "id"          SERIAL PRIMARY KEY,
  "pattern"     VARCHAR(255) UNIQUE NOT NULL,
  "match_type"  VARCHAR(20)  NOT NULL CHECK (match_type IN ('exact','suffix','regex')),
  "reason"      TEXT,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7.5 Partial unique index
DROP INDEX IF EXISTS "domain_settings_hostname_active_uniq";
CREATE UNIQUE INDEX "domain_settings_hostname_active_uniq"
  ON "domain_settings" ("hostname")
  WHERE "status" NOT IN ('disabled','failed_ownership','failed_certificate','failed_alias');

-- 7.6 Backfill verification_token
UPDATE "domain_settings"
SET "verification_token" = encode(gen_random_bytes(24), 'base64')
WHERE "verification_token" IS NULL;

-- 7.7 Map legacy 'pending_dns' rows
UPDATE "domain_settings"
SET "status" = 'pending_ownership'
WHERE "status" = 'pending_dns' AND "ownership" = 'custom_domain';

UPDATE "domain_settings"
SET "status" = 'active'
WHERE "ownership" = 'vendix_subdomain' AND "status" IN ('pending_dns','pending_ssl');

-- 7.8 Set expires_token_at
UPDATE "domain_settings"
SET "expires_token_at" = now() + INTERVAL '7 days'
WHERE "status" = 'pending_ownership' AND "expires_token_at" IS NULL;

-- 7.9 Seed inicial blocklist
INSERT INTO "domain_blocklist" (pattern, match_type, reason) VALUES
  ('google.com',       'suffix', 'Brand protection'),
  ('paypal.com',       'suffix', 'Phishing target'),
  ('apple.com',        'suffix', 'Brand protection'),
  ('microsoft.com',    'suffix', 'Brand protection'),
  ('facebook.com',     'suffix', 'Brand protection'),
  ('amazon.com',       'suffix', 'Brand protection'),
  ('netflix.com',      'suffix', 'Brand protection'),
  ('bancolombia.com',  'suffix', 'Financial — phishing target'),
  ('davivienda.com',   'suffix', 'Financial — phishing target'),
  ('bbva.com',         'suffix', 'Financial — phishing target'),
  ('.gov',             'suffix', 'Government TLD'),
  ('.mil',             'suffix', 'Military TLD')
ON CONFLICT (pattern) DO NOTHING;
