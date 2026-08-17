-- =============================================================================
-- Bug 10 — Membership soft-delete + audit trail
-- -----------------------------------------------------------------------------
-- Tables affected (schema-only, no row deletes / no truncates):
--   * memberships   -> ADD COLUMN deleted_at, deleted_by_user_id, deletion_reason
--                     ADD INDEX (store_id, deleted_at) para filtrar el listado
--                     por defecto (deleted_at IS NULL)
--
-- Why:
--   El usuario pidió poder eliminar membresías terminales (cancelled, suspended,
--   expired) para que no saturen el listado. Sin endpoint delete, el listado
--   se llena de membresías inactivas históricas. Soft-delete preserva audit
--   trail (quién, cuándo, motivo) sin perder data histórica.
--
-- Existing rows preserved:
--   * No row deletes / no truncates / no unscoped updates.
--   * Las 3 columnas son nullable con default NULL → todas las membresías
--     existentes quedan NOT-deleted (deleted_at = NULL).
--   * El nuevo índice (store_id, deleted_at) es APPEND-ONLY.
--
-- Compatibility:
--   * findAll() del backend debe filtrar deleted_at IS NULL por default.
--   * Toggle "Mostrar eliminadas" en el listado para audit.
-- =============================================================================

ALTER TABLE "memberships"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deleted_by_user_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "deletion_reason" TEXT;

CREATE INDEX IF NOT EXISTS "memberships_store_id_deleted_at_idx"
  ON "memberships"("store_id", "deleted_at");
