-- DATA IMPACT:
-- Tables affected: invoice_resolutions (solo esquema: 2 columnas nulas, 1 FK y 1 índice — ninguna fila se modifica)
-- Expected row changes: NINGUNO. No hay UPDATE, INSERT ni DELETE en este archivo.
--   Las columnas nuevas nacen NULL, que significa "no archivada": toda fila existente
--   queda exactamente como estaba y sigue siendo seleccionable.
-- Destructive operations: none. Sin DROP, TRUNCATE ni CASCADE.
-- FK/cascade risk: la FK nueva apunta a users(id) con ON DELETE SET NULL ON UPDATE NO ACTION;
--   borrar un usuario nunca borra ni bloquea una resolución. No se toca ninguna FK existente.
-- Idempotency: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS y la FK guardada
--   con un DO $$ sobre pg_constraint. Una segunda corrida no hace nada.
-- Atomicity: BEGIN/COMMIT EXPLÍCITOS (Prisma no envuelve el archivo en transacción).
-- Approval: archivado lógico de resoluciones, plan de facturación aprobado por el usuario.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ EXISTE
--
-- Las resoluciones de numeración pasan a tener ARCHIVADO LÓGICO. Nunca hay borrado
-- físico: archivar = is_active=false + archived_at=now() + archived_by_user_id.
-- Una fila archivada SIGUE ocupando su prefijo (los índices únicos parciales
-- `(entidad, prefijo, tipo)` no se tocan y no filtran por archivado), así una serie
-- `NC` archivada jamás se reabre como `NC1` y no se emite dos veces el mismo número.
--
-- NO se tocan los índices únicos parciales:
--   - invoice_resolutions_entity_prefix_doctype_uidx
--   - invoice_resolutions_store_prefix_doctype_no_entity_uidx
--   - invoice_resolutions_org_prefix_doctype_no_store_no_entity_uidx
-- ni los de 20260612120000_dian_configurations_uq_per_configuration_type.
--
-- El índice parcial idx_invoice_resolutions_archived acelera la selección de
-- resoluciones NO archivadas y no puede declararse en Prisma (igual que los únicos
-- parciales): revisar que un `migrate dev` generado no lo elimine.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE "invoice_resolutions" ADD COLUMN IF NOT EXISTS "archived_at" timestamp(6) NULL;
ALTER TABLE "invoice_resolutions" ADD COLUMN IF NOT EXISTS "archived_by_user_id" integer NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'invoice_resolutions_archived_by_user_id_fkey'
       AND conrelid = 'invoice_resolutions'::regclass
  ) THEN
    ALTER TABLE "invoice_resolutions"
      ADD CONSTRAINT "invoice_resolutions_archived_by_user_id_fkey"
      FOREIGN KEY ("archived_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_invoice_resolutions_archived"
    ON "invoice_resolutions" ("accounting_entity_id", "document_type")
 WHERE "archived_at" IS NULL;

COMMIT;
