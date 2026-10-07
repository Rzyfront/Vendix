-- DATA IMPACT:
-- Tables affected: received_tax_qualifications (new table only)
-- Expected row changes: none; no qualification or business rows are inserted
-- Destructive operations: none
-- FK/cascade risk: all references use RESTRICT; no cascading deletes
-- Idempotency: guarded table, constraints, indexes, functions, and triggers
-- Approval: authorized by the received-document tax consolidation decisions

CREATE TABLE IF NOT EXISTS "received_tax_qualifications" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "accounting_entity_id" INTEGER NOT NULL,
    "store_id" INTEGER,
    "document_id" INTEGER NOT NULL,
    "document_version" INTEGER NOT NULL,
    "tax_type" "tax_type_enum" NOT NULL,
    "jurisdiction_key" VARCHAR(100) NOT NULL,
    "canonical_identity_key" VARCHAR(64),
    "revision" INTEGER NOT NULL,
    "supersedes_id" INTEGER,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "outcome" VARCHAR(30) NOT NULL,
    "source_hash_snapshot" VARCHAR(64),
    "facts_hash" VARCHAR(64) NOT NULL,
    "decision_hash" VARCHAR(64) NOT NULL,
    "rules_version" VARCHAR(100) NOT NULL,
    "source_snapshot" JSONB NOT NULL,
    "basis_snapshot" JSONB NOT NULL,
    "decision_snapshot" JSONB NOT NULL,
    "overlap_snapshot" JSONB NOT NULL,
    "evidence_id" INTEGER NOT NULL,
    "qualified_by_user_id" INTEGER NOT NULL,
    "qualified_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "received_tax_qualifications_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_qualifications_org_fkey' AND conrelid = 'received_tax_qualifications'::regclass) THEN
        ALTER TABLE "received_tax_qualifications" ADD CONSTRAINT "received_tax_qualifications_org_fkey"
            FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_qualifications_entity_fkey' AND conrelid = 'received_tax_qualifications'::regclass) THEN
        ALTER TABLE "received_tax_qualifications" ADD CONSTRAINT "received_tax_qualifications_entity_fkey"
            FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_qualifications_store_fkey' AND conrelid = 'received_tax_qualifications'::regclass) THEN
        ALTER TABLE "received_tax_qualifications" ADD CONSTRAINT "received_tax_qualifications_store_fkey"
            FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_qualifications_document_fkey' AND conrelid = 'received_tax_qualifications'::regclass) THEN
        ALTER TABLE "received_tax_qualifications" ADD CONSTRAINT "received_tax_qualifications_document_fkey"
            FOREIGN KEY ("document_id") REFERENCES "received_documents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_qualifications_evidence_fkey' AND conrelid = 'received_tax_qualifications'::regclass) THEN
        ALTER TABLE "received_tax_qualifications" ADD CONSTRAINT "received_tax_qualifications_evidence_fkey"
            FOREIGN KEY ("evidence_id") REFERENCES "fiscal_evidences"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_qualifications_user_fkey' AND conrelid = 'received_tax_qualifications'::regclass) THEN
        ALTER TABLE "received_tax_qualifications" ADD CONSTRAINT "received_tax_qualifications_user_fkey"
            FOREIGN KEY ("qualified_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_qualifications_supersedes_fkey' AND conrelid = 'received_tax_qualifications'::regclass) THEN
        ALTER TABLE "received_tax_qualifications" ADD CONSTRAINT "received_tax_qualifications_supersedes_fkey"
            FOREIGN KEY ("supersedes_id") REFERENCES "received_tax_qualifications"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_qualifications_supersedes_key' AND conrelid = 'received_tax_qualifications'::regclass) THEN
        ALTER TABLE "received_tax_qualifications" ADD CONSTRAINT "received_tax_qualifications_supersedes_key" UNIQUE ("supersedes_id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_qualifications_tax_family_check' AND conrelid = 'received_tax_qualifications'::regclass) THEN
        ALTER TABLE "received_tax_qualifications" ADD CONSTRAINT "received_tax_qualifications_tax_family_check" CHECK ("tax_type" = 'iva');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_qualifications_outcome_check' AND conrelid = 'received_tax_qualifications'::regclass) THEN
        ALTER TABLE "received_tax_qualifications" ADD CONSTRAINT "received_tax_qualifications_outcome_check" CHECK ("outcome" IN ('eligible', 'ineligible', 'no_adjustment', 'legacy_owned', 'blocked'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_qualifications_eligible_identity_check' AND conrelid = 'received_tax_qualifications'::regclass) THEN
        ALTER TABLE "received_tax_qualifications" ADD CONSTRAINT "received_tax_qualifications_eligible_identity_check" CHECK ("outcome" <> 'eligible' OR "canonical_identity_key" IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_qualifications_positive_versions_check' AND conrelid = 'received_tax_qualifications'::regclass) THEN
        ALTER TABLE "received_tax_qualifications" ADD CONSTRAINT "received_tax_qualifications_positive_versions_check" CHECK ("revision" > 0 AND "document_version" > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_qualifications_root_revision_check' AND conrelid = 'received_tax_qualifications'::regclass) THEN
        ALTER TABLE "received_tax_qualifications" ADD CONSTRAINT "received_tax_qualifications_root_revision_check"
            CHECK (("supersedes_id" IS NULL) = ("revision" = 1));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_qualifications_identity_key_check' AND conrelid = 'received_tax_qualifications'::regclass) THEN
        ALTER TABLE "received_tax_qualifications" ADD CONSTRAINT "received_tax_qualifications_identity_key_check"
            CHECK ("canonical_identity_key" IS NULL OR "canonical_identity_key" ~ '^[0-9A-Fa-f]{64}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_qualifications_nonempty_text_check' AND conrelid = 'received_tax_qualifications'::regclass) THEN
        ALTER TABLE "received_tax_qualifications" ADD CONSTRAINT "received_tax_qualifications_nonempty_text_check"
            CHECK ("jurisdiction_key" ~ '[^[:space:]]' AND "rules_version" ~ '[^[:space:]]' AND "idempotency_key" ~ '[^[:space:]]');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_qualifications_hash_format_check' AND conrelid = 'received_tax_qualifications'::regclass) THEN
        ALTER TABLE "received_tax_qualifications" ADD CONSTRAINT "received_tax_qualifications_hash_format_check"
            CHECK ("facts_hash" ~ '^[0-9A-Fa-f]{64}$' AND "decision_hash" ~ '^[0-9A-Fa-f]{64}$' AND ("source_hash_snapshot" IS NULL OR "source_hash_snapshot" ~ '^[0-9A-Fa-f]{64}$'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_qualifications_snapshot_objects_check' AND conrelid = 'received_tax_qualifications'::regclass) THEN
        ALTER TABLE "received_tax_qualifications" ADD CONSTRAINT "received_tax_qualifications_snapshot_objects_check"
            CHECK (jsonb_typeof("source_snapshot") = 'object' AND jsonb_typeof("basis_snapshot") = 'object' AND jsonb_typeof("decision_snapshot") = 'object' AND jsonb_typeof("overlap_snapshot") = 'object');
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "received_tax_qualifications_scope_idempotency_key"
    ON "received_tax_qualifications"("organization_id", "accounting_entity_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "received_tax_qualifications_revision_key"
    ON "received_tax_qualifications"("organization_id", "accounting_entity_id", "document_id", "tax_type", "jurisdiction_key", "revision");
CREATE UNIQUE INDEX IF NOT EXISTS "received_tax_qualifications_canonical_root_key"
    ON "received_tax_qualifications"("organization_id", "accounting_entity_id", "tax_type", "jurisdiction_key", "canonical_identity_key")
    WHERE "supersedes_id" IS NULL AND "canonical_identity_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "received_tax_qualifications_document_root_key"
    ON "received_tax_qualifications"("organization_id", "accounting_entity_id", "document_id", "tax_type", "jurisdiction_key")
    WHERE "supersedes_id" IS NULL;
CREATE INDEX IF NOT EXISTS "received_tax_qualifications_document_idx"
    ON "received_tax_qualifications"("organization_id", "accounting_entity_id", "document_id", "tax_type", "jurisdiction_key");
CREATE INDEX IF NOT EXISTS "received_tax_qualifications_fiscal_read_idx"
    ON "received_tax_qualifications"("organization_id", "accounting_entity_id", "tax_type", "jurisdiction_key", "outcome", "qualified_at");
CREATE INDEX IF NOT EXISTS "received_tax_qualifications_evidence_idx"
    ON "received_tax_qualifications"("evidence_id");

CREATE OR REPLACE FUNCTION "enforce_received_tax_qualification_tenant_scope"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    document_org_id INTEGER;
    document_entity_id INTEGER;
    document_store_id INTEGER;
    document_version INTEGER;
    document_source_hash VARCHAR(64);
    evidence_org_id INTEGER;
    evidence_entity_id INTEGER;
    evidence_store_id INTEGER;
    evidence_storage_key TEXT;
    evidence_content_hash VARCHAR(128);
    entity_org_id INTEGER;
    store_org_id INTEGER;
    user_org_id INTEGER;
    previous_organization_id INTEGER;
    previous_entity_id INTEGER;
    previous_store_id INTEGER;
    previous_document_id INTEGER;
    previous_tax_type "tax_type_enum";
    previous_jurisdiction_key VARCHAR(100);
    previous_canonical_identity_key VARCHAR(64);
    previous_revision INTEGER;
    conflicting_document_id INTEGER;
BEGIN
    SELECT "organization_id" INTO entity_org_id
      FROM "accounting_entities" WHERE "id" = NEW."accounting_entity_id";
    IF entity_org_id IS DISTINCT FROM NEW."organization_id" THEN
        RAISE EXCEPTION 'received tax qualification accounting entity must belong to its organization';
    END IF;

    IF NEW."store_id" IS NOT NULL THEN
        SELECT "organization_id" INTO store_org_id FROM "stores" WHERE "id" = NEW."store_id";
        IF store_org_id IS DISTINCT FROM NEW."organization_id" THEN
            RAISE EXCEPTION 'received tax qualification store must belong to its organization';
        END IF;
    END IF;

    SELECT "organization_id", "accounting_entity_id", "store_id", "version", "source_hash"
      INTO document_org_id, document_entity_id, document_store_id, document_version, document_source_hash
      FROM "received_documents" WHERE "id" = NEW."document_id";
    IF document_org_id IS DISTINCT FROM NEW."organization_id"
       OR document_entity_id IS DISTINCT FROM NEW."accounting_entity_id"
       OR document_store_id IS DISTINCT FROM NEW."store_id" THEN
        RAISE EXCEPTION 'received tax qualification document must match its organization, entity, and store';
    END IF;
    IF NEW."document_version" IS DISTINCT FROM document_version
       OR NEW."source_hash_snapshot" IS DISTINCT FROM document_source_hash THEN
        RAISE EXCEPTION 'received tax qualification document snapshot is stale';
    END IF;

    SELECT "organization_id", "accounting_entity_id", "store_id", "storage_key", "content_hash"
      INTO evidence_org_id, evidence_entity_id, evidence_store_id, evidence_storage_key, evidence_content_hash
      FROM "fiscal_evidences" WHERE "id" = NEW."evidence_id";
    IF evidence_org_id IS DISTINCT FROM NEW."organization_id"
       OR evidence_entity_id IS DISTINCT FROM NEW."accounting_entity_id"
       OR (evidence_store_id IS NOT NULL AND evidence_store_id IS DISTINCT FROM NEW."store_id") THEN
        RAISE EXCEPTION 'received tax qualification evidence must match its organization and entity, and any evidence store must match';
    END IF;
    IF NEW."outcome" = 'eligible'
       AND NULLIF(BTRIM(evidence_storage_key), '') IS NULL
       AND NULLIF(BTRIM(evidence_content_hash), '') IS NULL THEN
        RAISE EXCEPTION 'eligible received tax qualification requires fiscal evidence artifact metadata';
    END IF;

    SELECT "organization_id" INTO user_org_id FROM "users" WHERE "id" = NEW."qualified_by_user_id";
    IF user_org_id IS DISTINCT FROM NEW."organization_id" THEN
        RAISE EXCEPTION 'received tax qualification user must belong to its organization';
    END IF;

    IF NEW."supersedes_id" IS NOT NULL THEN
        SELECT "organization_id", "accounting_entity_id", "store_id", "document_id", "tax_type",
               "jurisdiction_key", "canonical_identity_key", "revision"
          INTO previous_organization_id, previous_entity_id, previous_store_id, previous_document_id,
               previous_tax_type, previous_jurisdiction_key, previous_canonical_identity_key, previous_revision
          FROM "received_tax_qualifications" WHERE "id" = NEW."supersedes_id";
        IF previous_organization_id IS DISTINCT FROM NEW."organization_id"
           OR previous_entity_id IS DISTINCT FROM NEW."accounting_entity_id"
           OR previous_store_id IS DISTINCT FROM NEW."store_id"
           OR previous_document_id IS DISTINCT FROM NEW."document_id"
           OR previous_tax_type IS DISTINCT FROM NEW."tax_type"
           OR previous_jurisdiction_key IS DISTINCT FROM NEW."jurisdiction_key"
           OR (previous_canonical_identity_key IS NOT NULL AND previous_canonical_identity_key IS DISTINCT FROM NEW."canonical_identity_key")
           OR NEW."revision" IS DISTINCT FROM previous_revision + 1 THEN
            RAISE EXCEPTION 'received tax qualification successor must be the next revision in the same document scope';
        END IF;
    END IF;

    IF NEW."canonical_identity_key" IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(
            jsonb_build_array(NEW."organization_id", NEW."accounting_entity_id", NEW."tax_type"::TEXT,
                              NEW."jurisdiction_key", NEW."canonical_identity_key")::TEXT,
            0
        ));
        SELECT "document_id" INTO conflicting_document_id
          FROM "received_tax_qualifications"
         WHERE "organization_id" = NEW."organization_id"
           AND "accounting_entity_id" = NEW."accounting_entity_id"
           AND "tax_type" = NEW."tax_type"
           AND "jurisdiction_key" = NEW."jurisdiction_key"
           AND "canonical_identity_key" = NEW."canonical_identity_key"
           AND "document_id" <> NEW."document_id"
         LIMIT 1;
        IF FOUND THEN
            RAISE EXCEPTION 'canonical received tax identity is already assigned to another document';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "reject_received_tax_qualification_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'received tax qualifications are append-only';
END;
$$;

DROP TRIGGER IF EXISTS "received_tax_qualifications_tenant_scope_trigger" ON "received_tax_qualifications";
CREATE TRIGGER "received_tax_qualifications_tenant_scope_trigger"
    BEFORE INSERT ON "received_tax_qualifications"
    FOR EACH ROW EXECUTE FUNCTION "enforce_received_tax_qualification_tenant_scope"();
DROP TRIGGER IF EXISTS "received_tax_qualifications_append_only_trigger" ON "received_tax_qualifications";
CREATE TRIGGER "received_tax_qualifications_append_only_trigger"
    BEFORE UPDATE OR DELETE ON "received_tax_qualifications"
    FOR EACH ROW EXECUTE FUNCTION "reject_received_tax_qualification_mutation"();
