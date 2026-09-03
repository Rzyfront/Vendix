-- ============================================================================
-- QUI-XXX — KDS station heartbeat + auditoría de toma forzada
--
-- -- DATA IMPACT: ------------------------------------------------------------------------------
-- Cero mutación de filas existentes. Las dos columnas nacen NULL:
--   * `last_seen_at` — el chequeo "estación libre por inactividad" se hace
--     lazy en `assertCanMutateStationTicket` y compara contra
--     `COALESCE(last_seen_at, opened_at)`; mientras el heartbeat no se
--     actualice, la sesión no se libera por edad.
--   * `force_taken_by_user_id` — solo se estampa sobre una sesión CERRADA en el
--     momento exacto de la toma; las sesiones pre-existentes quedan con NULL,
--     que el código trata como "no hubo toma forzada".
--
-- Restricciones duras (verificables):
--   1. Columnas nullable, sin DEFAULT, sin ENUM nuevo.
--   2. FK explícita `force_taken_by_user_id REFERENCES users(id) ON DELETE SET NULL`
--      para que borrar el usuario tomador no rompa la auditoría.
--   3. Índice compuesto nuevo `kds_sessions_kds_id_last_seen_at_idx` para
--      sweeps futuros sin tocar el partial unique
--      `kds_sessions_one_open_per_kds` (que sigue garantizando una sola
--      sesión ABIERTA por KDS). El nombre y el orden de columnas deben
--      coincidir exactamente con el `@@index([kds_id, last_seen_at])` de
--      `schema.prisma` o el próximo `migrate dev` de otro carril genera
--      drift (regla aprendida en el ajuste A1 del plan).
--   4. La toma forzada cierra la sesión anterior y abre la nueva en la MISMA
--      transacción, en ese orden — el partial unique protege la ventana
--      concurrente.
-- ============================================================================

-- Columna 1: heartbeat de actividad del turno.
ALTER TABLE "kds_sessions"
  ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMP(6);

-- Columna 2: auditoría de toma forzada (nullable, sin default).
ALTER TABLE "kds_sessions"
  ADD COLUMN IF NOT EXISTS "force_taken_by_user_id" INTEGER;

-- Índice COMPUESTO `(kds_id, last_seen_at)` — toda consulta de inactividad
-- filtra primero por estación y luego por fecha; el orden de columnas
-- del índice tiene que coincidir exactamente con el de Prisma
-- (`@@index([kds_id, last_seen_at])` en `schema.prisma`) o el próximo
-- `migrate dev` de otro agente genera drift. El nombre es estable
-- (Prisma lo deriva de los nombres de columnas por convención).
CREATE INDEX IF NOT EXISTS "kds_sessions_kds_id_last_seen_at_idx"
  ON "kds_sessions"("kds_id", "last_seen_at");

-- FK explícita sobre `force_taken_by_user_id`. Idempotente para que la
-- migración pueda re-ejecutarse sin reventar. `ON DELETE SET NULL`:
-- si el usuario tomador se borra, la sesión mantiene la fila y la
-- columna queda NULL, lo cual el código lee como "no documentado a quién"
-- sin perder la sesión histórica.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kds_sessions_force_taken_by_user_id_fkey'
  ) THEN
    ALTER TABLE "kds_sessions"
      ADD CONSTRAINT "kds_sessions_force_taken_by_user_id_fkey"
      FOREIGN KEY ("force_taken_by_user_id")
      REFERENCES "users"("id")
      ON DELETE SET NULL
      ON UPDATE NO ACTION;
  END IF;
END $$;
