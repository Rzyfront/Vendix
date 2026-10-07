-- DATA IMPACT:
-- Tables affected: received_buyer_event_enablements (new table only)
-- Expected row changes: none; no existing rows are modified
-- Destructive operations: none
-- FK/cascade risk: new restrictive foreign keys; no cascading actions
-- Idempotency: CREATE TABLE, indexes, constraints, and foreign keys are catalog-guarded
-- Approval: approved implementation plan step 9 / D52-D53

CREATE TABLE IF NOT EXISTS "received_buyer_event_enablements" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "accounting_entity_id" INTEGER NOT NULL,
    "dian_configuration_id" INTEGER,
    "evidence_id" INTEGER,
    "status" VARCHAR(20) NOT NULL DEFAULT 'not_started',
    "event_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "verification_source" VARCHAR(30),
    "software_id_snapshot" VARCHAR(100),
    "certificate_fingerprint_snapshot" VARCHAR(128),
    "verified_by_user_id" INTEGER,
    "verified_at" TIMESTAMP(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,
    CONSTRAINT "received_buyer_event_enablements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "received_buyer_event_enablements_accounting_entity_id_key"
    ON "received_buyer_event_enablements"("accounting_entity_id");
CREATE UNIQUE INDEX IF NOT EXISTS "received_buyer_event_enablements_evidence_id_key"
    ON "received_buyer_event_enablements"("evidence_id");
CREATE INDEX IF NOT EXISTS "received_buyer_event_enablements_organization_id_status_idx"
    ON "received_buyer_event_enablements"("organization_id", "status");
CREATE INDEX IF NOT EXISTS "received_buyer_event_enablements_dian_configuration_id_idx"
    ON "received_buyer_event_enablements"("dian_configuration_id");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_buyer_event_enablements_organization_id_fkey' AND conrelid = '"received_buyer_event_enablements"'::regclass) THEN
        ALTER TABLE "received_buyer_event_enablements" ADD CONSTRAINT "received_buyer_event_enablements_organization_id_fkey"
            FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_buyer_event_enablements_accounting_entity_id_fkey' AND conrelid = '"received_buyer_event_enablements"'::regclass) THEN
        ALTER TABLE "received_buyer_event_enablements" ADD CONSTRAINT "received_buyer_event_enablements_accounting_entity_id_fkey"
            FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_buyer_event_enablements_dian_configuration_id_fkey' AND conrelid = '"received_buyer_event_enablements"'::regclass) THEN
        ALTER TABLE "received_buyer_event_enablements" ADD CONSTRAINT "received_buyer_event_enablements_dian_configuration_id_fkey"
            FOREIGN KEY ("dian_configuration_id") REFERENCES "dian_configurations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_buyer_event_enablements_evidence_id_fkey' AND conrelid = '"received_buyer_event_enablements"'::regclass) THEN
        ALTER TABLE "received_buyer_event_enablements" ADD CONSTRAINT "received_buyer_event_enablements_evidence_id_fkey"
            FOREIGN KEY ("evidence_id") REFERENCES "fiscal_evidences"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_buyer_event_enablements_verified_by_user_id_fkey' AND conrelid = '"received_buyer_event_enablements"'::regclass) THEN
        ALTER TABLE "received_buyer_event_enablements" ADD CONSTRAINT "received_buyer_event_enablements_verified_by_user_id_fkey"
            FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_buyer_event_enablements_status_chk' AND conrelid = '"received_buyer_event_enablements"'::regclass) THEN
        ALTER TABLE "received_buyer_event_enablements" ADD CONSTRAINT "received_buyer_event_enablements_status_chk"
            CHECK ("status" IN ('not_started', 'testing', 'verified', 'suspended'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_buyer_event_enablements_version_chk' AND conrelid = '"received_buyer_event_enablements"'::regclass) THEN
        ALTER TABLE "received_buyer_event_enablements" ADD CONSTRAINT "received_buyer_event_enablements_version_chk"
            CHECK ("version" >= 1);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_buyer_event_enablements_event_codes_chk' AND conrelid = '"received_buyer_event_enablements"'::regclass) THEN
        ALTER TABLE "received_buyer_event_enablements" ADD CONSTRAINT "received_buyer_event_enablements_event_codes_chk"
            CHECK ("event_codes" <@ ARRAY['030', '031', '032', '033']::TEXT[]);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_buyer_event_enablements_verification_source_chk' AND conrelid = '"received_buyer_event_enablements"'::regclass) THEN
        ALTER TABLE "received_buyer_event_enablements" ADD CONSTRAINT "received_buyer_event_enablements_verification_source_chk"
            CHECK ("verification_source" IS NULL OR "verification_source" IN ('test_set', 'convalidated', 'dian_portal'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_buyer_event_enablements_verified_complete_chk' AND conrelid = '"received_buyer_event_enablements"'::regclass) THEN
        ALTER TABLE "received_buyer_event_enablements" ADD CONSTRAINT "received_buyer_event_enablements_verified_complete_chk"
            CHECK ("status" <> 'verified' OR (
                "dian_configuration_id" IS NOT NULL AND "evidence_id" IS NOT NULL AND
                "verified_by_user_id" IS NOT NULL AND "verified_at" IS NOT NULL AND
                "verification_source" IS NOT NULL AND "software_id_snapshot" IS NOT NULL AND
                "certificate_fingerprint_snapshot" IS NOT NULL AND cardinality("event_codes") > 0
            ));
    END IF;
END $$;
