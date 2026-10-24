-- DATA IMPACT:
-- Tables affected: dian_configurations (solo esquema: 1 columna nula, 1 FK y 1 índice — ninguna fila se modifica)
-- Expected row changes: NINGUNO. No hay UPDATE, INSERT ni DELETE en este archivo.
--   La columna nueva nace NULL, que significa "la habilitación se ganó en esta misma
--   fila": toda configuración existente queda exactamente como estaba.
-- Destructive operations: none. Sin DROP, TRUNCATE ni CASCADE.
-- FK/cascade risk: la FK nueva es una auto-referencia a dian_configurations(id) con
--   ON DELETE SET NULL ON UPDATE NO ACTION; borrar la fila fuente suelta el puntero
--   pero NUNCA borra ni bloquea a la heredera. No se toca ninguna FK existente
--   (la auto-FK inherited_from_dian_configuration_id, de certificado, queda intacta).
-- Idempotency: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS y la FK guardada
--   con un DO $$ sobre pg_constraint. Una segunda corrida no hace nada.
-- Atomicity: BEGIN/COMMIT EXPLÍCITOS (Prisma no envuelve el archivo en transacción).
-- Approval: herencia de habilitación DIAN entre configuraciones con el mismo NIT,
--   software_id y tipo; plan de facturación aprobado por el usuario.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ EXISTE
--
-- Las tiendas demo usan el software de facturación de la plataforma con el NIT dueño
-- del software. Si otra dian_configurations con el mismo nit + software_id +
-- configuration_type ya está habilitada (enabled / test_set_passed), la fila nueva
-- hereda esa evidencia en vez de repetir el set de pruebas. Este puntero registra de
-- qué fila se heredó, para auditoría y para que la UI/gate distingan una habilitación
-- heredada de una ganada.
--
-- NO se tocan los índices únicos parciales de dian_configurations
-- (20260612120000_dian_configurations_uq_per_configuration_type) ni los de
-- invoice_resolutions: revisar que un `migrate dev` generado no los elimine.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE "dian_configurations" ADD COLUMN IF NOT EXISTS "enablement_inherited_from_id" integer NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dian_configurations_enablement_inherited_from_id_fkey'
       AND conrelid = 'dian_configurations'::regclass
  ) THEN
    ALTER TABLE "dian_configurations"
      ADD CONSTRAINT "dian_configurations_enablement_inherited_from_id_fkey"
      FOREIGN KEY ("enablement_inherited_from_id") REFERENCES "dian_configurations"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "dian_configurations_enablement_inherited_from_id_idx"
    ON "dian_configurations" ("enablement_inherited_from_id");

COMMIT;
