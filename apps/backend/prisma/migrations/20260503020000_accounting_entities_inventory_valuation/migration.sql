-- DATA IMPACT:
-- Tables affected: organizations, accounting_entities, chart_of_accounts, accounting_account_mappings, fiscal_periods, accounting_entries, suppliers, inventory_valuation_snapshots
-- Expected row changes: backfills organizations.operating_scope from account_type; creates base accounting_entities for existing organizations/stores; best-effort fills accounting_entity_id on existing accounting records; best-effort fills suppliers.store_id for single-store STORE organizations.
-- Destructive operations: none. No DROP/TRUNCATE/DELETE.
-- FK/cascade risk: new foreign keys use RESTRICT or SET NULL; no new ON DELETE CASCADE.
-- Idempotency: guarded by IF NOT EXISTS, catalog checks, WHERE predicates, and ON CONFLICT DO NOTHING.
-- Approval: user approved full execution in chat for organization_operating_scope, accounting entities, and historical inventory valuation.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'organization_operating_scope_enum') THEN
    CREATE TYPE "organization_operating_scope_enum" AS ENUM ('STORE', 'ORGANIZATION');
  END IF;
END $$;

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "operating_scope" "organization_operating_scope_enum" NOT NULL DEFAULT 'STORE';

UPDATE "organizations"
SET "operating_scope" = CASE
  WHEN "account_type" = 'MULTI_STORE_ORG' THEN 'ORGANIZATION'::"organization_operating_scope_enum"
  ELSE 'STORE'::"organization_operating_scope_enum"
END
WHERE "operating_scope" IS DISTINCT FROM CASE
  WHEN "account_type" = 'MULTI_STORE_ORG' THEN 'ORGANIZATION'::"organization_operating_scope_enum"
  ELSE 'STORE'::"organization_operating_scope_enum"
END;

CREATE TABLE IF NOT EXISTS "accounting_entities" (
  "id" SERIAL PRIMARY KEY,
  "organization_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "scope" "organization_operating_scope_enum" NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "legal_name" VARCHAR(255),
  "tax_id" VARCHAR(50),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_entities_organization_id_fkey') THEN
    ALTER TABLE "accounting_entities"
      ADD CONSTRAINT "accounting_entities_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_entities_store_id_fkey') THEN
    ALTER TABLE "accounting_entities"
      ADD CONSTRAINT "accounting_entities_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_entities_scope_store_check') THEN
    ALTER TABLE "accounting_entities"
      ADD CONSTRAINT "accounting_entities_scope_store_check"
      CHECK (("scope" = 'ORGANIZATION' AND "store_id" IS NULL) OR ("scope" = 'STORE' AND "store_id" IS NOT NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_entities_organization_store_scope_key') THEN
    ALTER TABLE "accounting_entities"
      ADD CONSTRAINT "accounting_entities_organization_store_scope_key"
      UNIQUE ("organization_id", "store_id", "scope");
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "accounting_entities_org_scope_uidx"
  ON "accounting_entities" ("organization_id", "scope")
  WHERE "store_id" IS NULL AND "scope" = 'ORGANIZATION';

CREATE UNIQUE INDEX IF NOT EXISTS "accounting_entities_store_scope_uidx"
  ON "accounting_entities" ("organization_id", "store_id", "scope")
  WHERE "store_id" IS NOT NULL AND "scope" = 'STORE';

CREATE INDEX IF NOT EXISTS "accounting_entities_organization_scope_idx" ON "accounting_entities" ("organization_id", "scope");
CREATE INDEX IF NOT EXISTS "accounting_entities_store_id_idx" ON "accounting_entities" ("store_id");
CREATE INDEX IF NOT EXISTS "accounting_entities_organization_active_idx" ON "accounting_entities" ("organization_id", "is_active");
CREATE INDEX IF NOT EXISTS "organizations_operating_scope_idx" ON "organizations" ("operating_scope");

INSERT INTO "accounting_entities" ("organization_id", "store_id", "scope", "name", "legal_name", "tax_id")
SELECT o."id", NULL, 'ORGANIZATION'::"organization_operating_scope_enum", o."name", o."legal_name", o."tax_id"
FROM "organizations" o
WHERE o."operating_scope" = 'ORGANIZATION'
  AND NOT EXISTS (
    SELECT 1
    FROM "accounting_entities" ae
    WHERE ae."organization_id" = o."id"
      AND ae."store_id" IS NULL
      AND ae."scope" = 'ORGANIZATION'
  )
ON CONFLICT DO NOTHING;

INSERT INTO "accounting_entities" ("organization_id", "store_id", "scope", "name", "legal_name", "tax_id")
SELECT s."organization_id", s."id", 'STORE'::"organization_operating_scope_enum", s."name", COALESCE(o."legal_name", s."name"), o."tax_id"
FROM "stores" s
JOIN "organizations" o ON o."id" = s."organization_id"
WHERE NOT EXISTS (
  SELECT 1
  FROM "accounting_entities" ae
  WHERE ae."organization_id" = s."organization_id"
    AND ae."store_id" = s."id"
    AND ae."scope" = 'STORE'
)
ON CONFLICT DO NOTHING;

ALTER TABLE "chart_of_accounts" ADD COLUMN IF NOT EXISTS "accounting_entity_id" INTEGER;
ALTER TABLE "accounting_account_mappings" ADD COLUMN IF NOT EXISTS "accounting_entity_id" INTEGER;
ALTER TABLE "fiscal_periods" ADD COLUMN IF NOT EXISTS "accounting_entity_id" INTEGER;
ALTER TABLE "accounting_entries" ADD COLUMN IF NOT EXISTS "accounting_entity_id" INTEGER;
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "store_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chart_of_accounts_accounting_entity_id_fkey') THEN
    ALTER TABLE "chart_of_accounts"
      ADD CONSTRAINT "chart_of_accounts_accounting_entity_id_fkey"
      FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_account_mappings_accounting_entity_id_fkey') THEN
    ALTER TABLE "accounting_account_mappings"
      ADD CONSTRAINT "accounting_account_mappings_accounting_entity_id_fkey"
      FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_periods_accounting_entity_id_fkey') THEN
    ALTER TABLE "fiscal_periods"
      ADD CONSTRAINT "fiscal_periods_accounting_entity_id_fkey"
      FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_entries_accounting_entity_id_fkey') THEN
    ALTER TABLE "accounting_entries"
      ADD CONSTRAINT "accounting_entries_accounting_entity_id_fkey"
      FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_store_id_fkey') THEN
    ALTER TABLE "suppliers"
      ADD CONSTRAINT "suppliers_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "chart_of_accounts_accounting_entity_id_idx" ON "chart_of_accounts" ("accounting_entity_id");
CREATE UNIQUE INDEX IF NOT EXISTS "chart_of_accounts_entity_code_uidx" ON "chart_of_accounts" ("accounting_entity_id", "code") WHERE "accounting_entity_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "accounting_account_mappings_accounting_entity_id_idx" ON "accounting_account_mappings" ("accounting_entity_id");
CREATE INDEX IF NOT EXISTS "fiscal_periods_accounting_entity_id_idx" ON "fiscal_periods" ("accounting_entity_id");
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_periods_entity_name_uidx" ON "fiscal_periods" ("accounting_entity_id", "name") WHERE "accounting_entity_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "accounting_entries_accounting_entity_id_idx" ON "accounting_entries" ("accounting_entity_id");
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_entries_entity_number_uidx" ON "accounting_entries" ("accounting_entity_id", "entry_number") WHERE "accounting_entity_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "suppliers_organization_store_code_idx" ON "suppliers" ("organization_id", "store_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_org_code_uidx" ON "suppliers" ("organization_id", "code") WHERE "store_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_store_code_uidx" ON "suppliers" ("organization_id", "store_id", "code") WHERE "store_id" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chart_of_accounts_organization_id_code_key') THEN
    ALTER TABLE "chart_of_accounts" DROP CONSTRAINT "chart_of_accounts_organization_id_code_key";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_periods_organization_id_name_key') THEN
    ALTER TABLE "fiscal_periods" DROP CONSTRAINT "fiscal_periods_organization_id_name_key";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_entries_organization_id_entry_number_key') THEN
    ALTER TABLE "accounting_entries" DROP CONSTRAINT "accounting_entries_organization_id_entry_number_key";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_organization_id_code_key') THEN
    ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_organization_id_code_key";
  END IF;
END $$;

WITH single_store_orgs AS (
  SELECT "organization_id", MIN("id") AS "store_id"
  FROM "stores"
  GROUP BY "organization_id"
  HAVING COUNT(*) = 1
)
UPDATE "suppliers" s
SET "store_id" = sso."store_id"
FROM "organizations" o
JOIN single_store_orgs sso ON sso."organization_id" = o."id"
WHERE s."organization_id" = o."id"
  AND o."operating_scope" = 'STORE'
  AND s."store_id" IS NULL;

WITH single_store_orgs AS (
  SELECT "organization_id", MIN("id") AS "store_id"
  FROM "stores"
  GROUP BY "organization_id"
  HAVING COUNT(*) = 1
)
UPDATE "chart_of_accounts" coa
SET "accounting_entity_id" = ae."id"
FROM "organizations" o
LEFT JOIN single_store_orgs sso ON sso."organization_id" = o."id"
JOIN "accounting_entities" ae ON ae."organization_id" = o."id"
  AND (
    (o."operating_scope" = 'ORGANIZATION' AND ae."scope" = 'ORGANIZATION' AND ae."store_id" IS NULL)
    OR (o."operating_scope" = 'STORE' AND ae."scope" = 'STORE' AND ae."store_id" = sso."store_id")
  )
WHERE coa."organization_id" = o."id"
  AND coa."accounting_entity_id" IS NULL;

UPDATE "accounting_account_mappings" aam
SET "accounting_entity_id" = ae."id"
FROM "organizations" o
JOIN "accounting_entities" ae ON ae."organization_id" = o."id"
WHERE aam."organization_id" = o."id"
  AND aam."accounting_entity_id" IS NULL
  AND (
    (o."operating_scope" = 'ORGANIZATION' AND ae."scope" = 'ORGANIZATION' AND ae."store_id" IS NULL)
    OR (o."operating_scope" = 'STORE' AND ae."scope" = 'STORE' AND ae."store_id" = aam."store_id")
  );

WITH single_store_orgs AS (
  SELECT "organization_id", MIN("id") AS "store_id"
  FROM "stores"
  GROUP BY "organization_id"
  HAVING COUNT(*) = 1
)
UPDATE "fiscal_periods" fp
SET "accounting_entity_id" = ae."id"
FROM "organizations" o
LEFT JOIN single_store_orgs sso ON sso."organization_id" = o."id"
JOIN "accounting_entities" ae ON ae."organization_id" = o."id"
  AND (
    (o."operating_scope" = 'ORGANIZATION' AND ae."scope" = 'ORGANIZATION' AND ae."store_id" IS NULL)
    OR (o."operating_scope" = 'STORE' AND ae."scope" = 'STORE' AND ae."store_id" = sso."store_id")
  )
WHERE fp."organization_id" = o."id"
  AND fp."accounting_entity_id" IS NULL;

WITH single_store_orgs AS (
  SELECT "organization_id", MIN("id") AS "store_id"
  FROM "stores"
  GROUP BY "organization_id"
  HAVING COUNT(*) = 1
)
UPDATE "accounting_entries" ae0
SET "accounting_entity_id" = ae."id"
FROM "organizations" o
LEFT JOIN single_store_orgs sso ON sso."organization_id" = o."id"
JOIN "accounting_entities" ae ON ae."organization_id" = o."id"
WHERE ae0."organization_id" = o."id"
  AND ae0."accounting_entity_id" IS NULL
  AND (
    (o."operating_scope" = 'ORGANIZATION' AND ae."scope" = 'ORGANIZATION' AND ae."store_id" IS NULL)
    OR (o."operating_scope" = 'STORE' AND ae."scope" = 'STORE' AND ae."store_id" = COALESCE(ae0."store_id", sso."store_id"))
  );

CREATE TABLE IF NOT EXISTS "inventory_valuation_snapshots" (
  "id" SERIAL PRIMARY KEY,
  "organization_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "accounting_entity_id" INTEGER,
  "location_id" INTEGER NOT NULL,
  "product_id" INTEGER NOT NULL,
  "product_variant_id" INTEGER,
  "snapshot_at" TIMESTAMP(6) NOT NULL,
  "quantity_on_hand" DECIMAL(18,4) NOT NULL,
  "quantity_reserved" DECIMAL(18,4) NOT NULL,
  "quantity_available" DECIMAL(18,4) NOT NULL,
  "unit_cost" DECIMAL(12,4) NOT NULL,
  "total_value" DECIMAL(18,4) NOT NULL,
  "costing_method" "costing_method_enum" NOT NULL,
  "operating_scope" "organization_operating_scope_enum" NOT NULL,
  "source_type" VARCHAR(50),
  "source_id" INTEGER,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_valuation_snapshots_organization_id_fkey') THEN
    ALTER TABLE "inventory_valuation_snapshots"
      ADD CONSTRAINT "inventory_valuation_snapshots_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_valuation_snapshots_store_id_fkey') THEN
    ALTER TABLE "inventory_valuation_snapshots"
      ADD CONSTRAINT "inventory_valuation_snapshots_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_valuation_snapshots_accounting_entity_id_fkey') THEN
    ALTER TABLE "inventory_valuation_snapshots"
      ADD CONSTRAINT "inventory_valuation_snapshots_accounting_entity_id_fkey"
      FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_valuation_snapshots_location_id_fkey') THEN
    ALTER TABLE "inventory_valuation_snapshots"
      ADD CONSTRAINT "inventory_valuation_snapshots_location_id_fkey"
      FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_valuation_snapshots_product_id_fkey') THEN
    ALTER TABLE "inventory_valuation_snapshots"
      ADD CONSTRAINT "inventory_valuation_snapshots_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_valuation_snapshots_product_variant_id_fkey') THEN
    ALTER TABLE "inventory_valuation_snapshots"
      ADD CONSTRAINT "inventory_valuation_snapshots_product_variant_id_fkey"
      FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "inventory_valuation_snapshots_org_snapshot_idx" ON "inventory_valuation_snapshots" ("organization_id", "snapshot_at");
CREATE INDEX IF NOT EXISTS "inventory_valuation_snapshots_org_store_snapshot_idx" ON "inventory_valuation_snapshots" ("organization_id", "store_id", "snapshot_at");
CREATE INDEX IF NOT EXISTS "inventory_valuation_snapshots_entity_snapshot_idx" ON "inventory_valuation_snapshots" ("accounting_entity_id", "snapshot_at");
CREATE INDEX IF NOT EXISTS "inventory_valuation_snapshots_location_product_idx" ON "inventory_valuation_snapshots" ("location_id", "product_id", "product_variant_id");
CREATE INDEX IF NOT EXISTS "inventory_valuation_snapshots_product_snapshot_idx" ON "inventory_valuation_snapshots" ("product_id", "product_variant_id", "snapshot_at");
CREATE INDEX IF NOT EXISTS "inventory_valuation_snapshots_source_idx" ON "inventory_valuation_snapshots" ("source_type", "source_id");
