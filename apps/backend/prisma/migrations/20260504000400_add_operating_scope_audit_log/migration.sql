-- DATA IMPACT:
-- Tables affected: operating_scope_audit_log (new table)
-- Expected row changes: 0 filas iniciales. Tabla nueva, sin datos preexistentes.
-- Destructive operations: none. No DROP, no TRUNCATE, no DELETE/UPDATE sin WHERE, no CASCADE.
-- FK/cascade risk: dos FKs nuevas con ON DELETE RESTRICT (preserva historial aunque borren la org/usuario).
-- Idempotency: guarded by IF NOT EXISTS en CREATE TABLE/INDEX y por catálogo en FKs.
-- Approval: sub-fase 1B del plan de Operating Scope. Usuario aprobó migración aditiva pura.
-- Notes:
--   * `organizations.is_partner` ya existe en BD (verificado vía information_schema). No se recrea.
--   * `organization_operating_scope_enum` ya existe en BD (creado en migración 20260503020000). Se reutiliza.
--   * Migración aditiva pura: solo CREATE TABLE + CREATE INDEX + ADD CONSTRAINT.

-- CreateTable
CREATE TABLE IF NOT EXISTS "operating_scope_audit_log" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "previous_value" "organization_operating_scope_enum" NOT NULL,
    "new_value" "organization_operating_scope_enum" NOT NULL,
    "changed_by_user_id" INTEGER NOT NULL,
    "changed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "operating_scope_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "operating_scope_audit_log_organization_id_changed_at_idx"
  ON "operating_scope_audit_log"("organization_id", "changed_at" DESC);

-- AddForeignKey (organization_id -> organizations.id, ON DELETE RESTRICT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operating_scope_audit_log_organization_id_fkey'
  ) THEN
    ALTER TABLE "operating_scope_audit_log"
      ADD CONSTRAINT "operating_scope_audit_log_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey (changed_by_user_id -> users.id, ON DELETE RESTRICT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operating_scope_audit_log_changed_by_user_id_fkey'
  ) THEN
    ALTER TABLE "operating_scope_audit_log"
      ADD CONSTRAINT "operating_scope_audit_log_changed_by_user_id_fkey"
      FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
