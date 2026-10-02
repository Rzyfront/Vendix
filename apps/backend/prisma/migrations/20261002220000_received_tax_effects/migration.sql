-- DATA IMPACT:
-- Tables affected: received_tax_effects (new table only)
-- Expected row changes: none; effects are not generated automatically
-- Destructive operations: none
-- FK/cascade risk: all references use RESTRICT; no cascading deletes
-- Idempotency: guarded table, constraints, indexes, functions, and triggers
-- Approval: authorized as the append-only effect ledger for qualified received VAT

CREATE TABLE IF NOT EXISTS "received_tax_effects" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER,
    "accounting_entity_id" INTEGER,
    "store_id" INTEGER,
    "qualification_id" INTEGER NOT NULL,
    "tax_type" "tax_type_enum" NOT NULL,
    "jurisdiction_key" VARCHAR(100) NOT NULL,
    "effect_key" VARCHAR(160) NOT NULL,
    "group_key" VARCHAR(64) NOT NULL,
    "effect_kind" VARCHAR(20) NOT NULL,
    "effective_date" DATE NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "signed_base_amount" DECIMAL(15,2) NOT NULL,
    "signed_tax_amount" DECIMAL(15,2) NOT NULL,
    "adjusts_effect_id" INTEGER,
    "reversal_of_id" INTEGER,
    "payload_hash" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "received_tax_effects_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_effects_org_fkey' AND conrelid = 'received_tax_effects'::regclass) THEN
        ALTER TABLE "received_tax_effects" ADD CONSTRAINT "received_tax_effects_org_fkey"
            FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_effects_entity_fkey' AND conrelid = 'received_tax_effects'::regclass) THEN
        ALTER TABLE "received_tax_effects" ADD CONSTRAINT "received_tax_effects_entity_fkey"
            FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_effects_store_fkey' AND conrelid = 'received_tax_effects'::regclass) THEN
        ALTER TABLE "received_tax_effects" ADD CONSTRAINT "received_tax_effects_store_fkey"
            FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_effects_qualification_fkey' AND conrelid = 'received_tax_effects'::regclass) THEN
        ALTER TABLE "received_tax_effects" ADD CONSTRAINT "received_tax_effects_qualification_fkey"
            FOREIGN KEY ("qualification_id") REFERENCES "received_tax_qualifications"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_effects_adjusts_fkey' AND conrelid = 'received_tax_effects'::regclass) THEN
        ALTER TABLE "received_tax_effects" ADD CONSTRAINT "received_tax_effects_adjusts_fkey"
            FOREIGN KEY ("adjusts_effect_id") REFERENCES "received_tax_effects"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_effects_reversal_fkey' AND conrelid = 'received_tax_effects'::regclass) THEN
        ALTER TABLE "received_tax_effects" ADD CONSTRAINT "received_tax_effects_reversal_fkey"
            FOREIGN KEY ("reversal_of_id") REFERENCES "received_tax_effects"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_effects_tax_family_check' AND conrelid = 'received_tax_effects'::regclass) THEN
        ALTER TABLE "received_tax_effects" ADD CONSTRAINT "received_tax_effects_tax_family_check" CHECK ("tax_type" = 'iva');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_effects_currency_check' AND conrelid = 'received_tax_effects'::regclass) THEN
        ALTER TABLE "received_tax_effects" ADD CONSTRAINT "received_tax_effects_currency_check" CHECK ("currency" = 'COP');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_effects_kind_check' AND conrelid = 'received_tax_effects'::regclass) THEN
        ALTER TABLE "received_tax_effects" ADD CONSTRAINT "received_tax_effects_kind_check" CHECK ("effect_kind" IN ('recognition', 'adjustment', 'reversal'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_effects_amount_check' AND conrelid = 'received_tax_effects'::regclass) THEN
        ALTER TABLE "received_tax_effects" ADD CONSTRAINT "received_tax_effects_amount_check" CHECK (
            "signed_tax_amount" <> 0
            AND ("effect_kind" <> 'recognition' OR ("signed_tax_amount" > 0 AND "signed_base_amount" >= 0))
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_effects_reference_shape_check' AND conrelid = 'received_tax_effects'::regclass) THEN
        ALTER TABLE "received_tax_effects" ADD CONSTRAINT "received_tax_effects_reference_shape_check" CHECK (
            ("effect_kind" = 'recognition' AND "adjusts_effect_id" IS NULL AND "reversal_of_id" IS NULL)
            OR ("effect_kind" = 'adjustment' AND "adjusts_effect_id" IS NOT NULL AND "reversal_of_id" IS NULL)
            OR ("effect_kind" = 'reversal' AND "adjusts_effect_id" IS NULL AND "reversal_of_id" IS NOT NULL)
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_effects_nonempty_text_check' AND conrelid = 'received_tax_effects'::regclass) THEN
        ALTER TABLE "received_tax_effects" ADD CONSTRAINT "received_tax_effects_nonempty_text_check" CHECK (
            "effect_key" ~ '[^[:space:]]' AND "group_key" ~ '[^[:space:]]' AND "jurisdiction_key" ~ '[^[:space:]]'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_tax_effects_payload_hash_check' AND conrelid = 'received_tax_effects'::regclass) THEN
        ALTER TABLE "received_tax_effects" ADD CONSTRAINT "received_tax_effects_payload_hash_check" CHECK ("payload_hash" ~ '^[0-9A-Fa-f]{64}$');
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "received_tax_effects_scope_effect_key"
    ON "received_tax_effects"("organization_id", "accounting_entity_id", "effect_key");
CREATE UNIQUE INDEX IF NOT EXISTS "received_tax_effects_reversal_of_key"
    ON "received_tax_effects"("reversal_of_id") WHERE "reversal_of_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "received_tax_effects_period_idx"
    ON "received_tax_effects"("organization_id", "accounting_entity_id", "tax_type", "jurisdiction_key", "effective_date");
CREATE INDEX IF NOT EXISTS "received_tax_effects_qualification_idx"
    ON "received_tax_effects"("qualification_id");

CREATE OR REPLACE FUNCTION "enforce_received_tax_effect_scope"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    qualification_org_id INTEGER;
    qualification_entity_id INTEGER;
    qualification_store_id INTEGER;
    qualification_tax_type "tax_type_enum";
    qualification_jurisdiction_key VARCHAR(100);
    qualification_outcome VARCHAR(30);
    qualification_document_id INTEGER;
    referenced_org_id INTEGER;
    referenced_entity_id INTEGER;
    referenced_store_id INTEGER;
    referenced_tax_type "tax_type_enum";
    referenced_jurisdiction_key VARCHAR(100);
    referenced_base_amount DECIMAL(15,2);
    referenced_tax_amount DECIMAL(15,2);
    referenced_qualification_id INTEGER;
    referenced_document_id INTEGER;
BEGIN
    SELECT "organization_id", "accounting_entity_id", "store_id", "tax_type", "jurisdiction_key", "outcome", "document_id"
      INTO qualification_org_id, qualification_entity_id, qualification_store_id, qualification_tax_type,
           qualification_jurisdiction_key, qualification_outcome, qualification_document_id
      FROM "received_tax_qualifications" WHERE "id" = NEW."qualification_id";

    IF qualification_org_id IS DISTINCT FROM NEW."organization_id"
       OR qualification_entity_id IS DISTINCT FROM NEW."accounting_entity_id"
       OR qualification_store_id IS DISTINCT FROM NEW."store_id"
       OR qualification_tax_type IS DISTINCT FROM NEW."tax_type"
       OR qualification_jurisdiction_key IS DISTINCT FROM NEW."jurisdiction_key" THEN
        RAISE EXCEPTION 'received tax effect must match its qualification organization, entity, store, tax type, and jurisdiction';
    END IF;

    IF NEW."effect_kind" IN ('recognition', 'adjustment') AND qualification_outcome IS DISTINCT FROM 'eligible' THEN
        RAISE EXCEPTION 'received tax recognition and adjustment effects require an eligible qualification';
    END IF;

    IF NEW."effect_kind" IN ('adjustment', 'reversal') THEN
        SELECT "organization_id", "accounting_entity_id", "store_id", "tax_type", "jurisdiction_key",
               "signed_base_amount", "signed_tax_amount", "qualification_id"
          INTO referenced_org_id, referenced_entity_id, referenced_store_id, referenced_tax_type,
               referenced_jurisdiction_key, referenced_base_amount, referenced_tax_amount, referenced_qualification_id
          FROM "received_tax_effects"
         WHERE "id" = CASE WHEN NEW."effect_kind" = 'adjustment' THEN NEW."adjusts_effect_id" ELSE NEW."reversal_of_id" END;

        IF referenced_org_id IS DISTINCT FROM NEW."organization_id"
           OR referenced_entity_id IS DISTINCT FROM NEW."accounting_entity_id"
           OR referenced_store_id IS DISTINCT FROM NEW."store_id"
           OR referenced_tax_type IS DISTINCT FROM NEW."tax_type"
           OR referenced_jurisdiction_key IS DISTINCT FROM NEW."jurisdiction_key" THEN
            RAISE EXCEPTION 'received tax adjustment or reversal target must match its effect scope';
        END IF;

        IF NEW."effect_kind" = 'reversal' THEN
            SELECT "document_id" INTO referenced_document_id
              FROM "received_tax_qualifications" WHERE "id" = referenced_qualification_id;
            IF qualification_document_id IS DISTINCT FROM referenced_document_id THEN
                RAISE EXCEPTION 'received tax reversal qualification must refer to the reversed effect document';
            END IF;
            IF NEW."signed_base_amount" <> -referenced_base_amount OR NEW."signed_tax_amount" <> -referenced_tax_amount THEN
                RAISE EXCEPTION 'received tax reversal amounts must exactly negate the reversed effect';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "reject_received_tax_effect_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'received tax effects are append-only';
END;
$$;

DROP TRIGGER IF EXISTS "received_tax_effects_scope_guard" ON "received_tax_effects";
CREATE TRIGGER "received_tax_effects_scope_guard"
    BEFORE INSERT ON "received_tax_effects"
    FOR EACH ROW EXECUTE FUNCTION "enforce_received_tax_effect_scope"();

DROP TRIGGER IF EXISTS "received_tax_effects_immutable" ON "received_tax_effects";
CREATE TRIGGER "received_tax_effects_immutable"
    BEFORE UPDATE OR DELETE ON "received_tax_effects"
    FOR EACH ROW EXECUTE FUNCTION "reject_received_tax_effect_mutation"();
