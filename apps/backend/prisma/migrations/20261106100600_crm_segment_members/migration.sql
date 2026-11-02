-- CRM · miembros manuales de segmento (agregar/quitar un cliente a un
-- segmento desde su ficha). Un segmento pasa a ser sus reglas ∪ estos miembros.
--
-- DATA IMPACT:
--   Tables affected: 1 tabla NUEVA (crm_segment_members).
--   Expected row changes: 0. No DML.
--   Destructive operations: ninguna. Sin DROP, UPDATE, DELETE ni TRUNCATE.
--   FK/cascade risk: store_id -> stores y customer_id -> users son RESTRICT;
--   created_by_user_id -> users es SET NULL. Única CASCADE:
--   segment_id -> crm_segments (borrar un segmento quita sus miembros, nunca
--   clientes), igual que crm_customer_tags -> crm_tags.
--   Idempotency: CREATE TABLE/INDEX IF NOT EXISTS y FKs protegidas con
--   pg_constraint.
--   Approval: brief CRM de Rafael (2026-11-02), punto 3.

CREATE TABLE IF NOT EXISTS "crm_segment_members" (
    "store_id" INTEGER NOT NULL,
    "segment_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_segment_members_pkey" PRIMARY KEY ("segment_id", "customer_id")
);

CREATE INDEX IF NOT EXISTS "crm_segment_members_store_id_customer_id_idx"
    ON "crm_segment_members"("store_id", "customer_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_segment_members_store_id_fkey') THEN
    ALTER TABLE "crm_segment_members" ADD CONSTRAINT "crm_segment_members_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_segment_members_segment_id_fkey') THEN
    ALTER TABLE "crm_segment_members" ADD CONSTRAINT "crm_segment_members_segment_id_fkey"
      FOREIGN KEY ("segment_id") REFERENCES "crm_segments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_segment_members_customer_id_fkey') THEN
    ALTER TABLE "crm_segment_members" ADD CONSTRAINT "crm_segment_members_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_segment_members_created_by_user_id_fkey') THEN
    ALTER TABLE "crm_segment_members" ADD CONSTRAINT "crm_segment_members_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
