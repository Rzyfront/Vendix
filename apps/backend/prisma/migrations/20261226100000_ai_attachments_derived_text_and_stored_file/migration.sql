-- M10 (Vex Plus F6, T41/T44): adjuntos con texto derivado y promoción a stored_files.
--
-- DATA IMPACT:
-- Tables affected: ai_attachments (schema only)
-- Expected row changes: none (ninguna fila mutada; dos columnas nullable nuevas, todas en NULL)
-- Destructive operations: none (sin DELETE, TRUNCATE, DROP, CASCADE, INSERT ni UPDATE)
-- FK/cascade risk: FK nueva ai_attachments.stored_file_id -> stored_files.id con ON DELETE SET NULL
--   (borrar el archivo promovido nunca borra el adjunto ni el registro de negocio)
-- Idempotency: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS y FK guardada por pg_constraint
-- Approval: plan odd/tasks/vex-agente-avanzado.md §3.9 (M10, sin mutación de filas)

-- Clave S3 del texto extraído (derivado). El original en s3_key nunca se sobrescribe.
ALTER TABLE "ai_attachments" ADD COLUMN IF NOT EXISTS "derived_text_key" VARCHAR(500);

-- Archivo del módulo documental al que se promovió el adjunto (attach_document_to_record).
ALTER TABLE "ai_attachments" ADD COLUMN IF NOT EXISTS "stored_file_id" INTEGER;

CREATE INDEX IF NOT EXISTS "ai_attachments_stored_file_id_idx" ON "ai_attachments"("stored_file_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_attachments_stored_file_id_fkey'
  ) THEN
    ALTER TABLE "ai_attachments"
      ADD CONSTRAINT "ai_attachments_stored_file_id_fkey"
      FOREIGN KEY ("stored_file_id") REFERENCES "stored_files"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
