-- =====================================================================
-- Migration: table_sessions_one_open_per_table (CP-POLLO-ARABE-727 A.3)
-- Purpose: Índice único parcial que impide dos sesiones ABIERTAS simultáneas
--          en la misma mesa (el fix de lectura de A.5 con take:1 seguiría
--          siendo ambiguo sin este invariante).
-- =====================================================================
--
-- DATA IMPACT:
--   Tables affected: table_sessions (schema-only, índice único)
--   Rows mutated:    NONE
--   Destructive operations: none
--   FK/cascade risk: none
--   Idempotency: CREATE UNIQUE INDEX IF NOT EXISTS
--   Approval: CP-POLLO-ARABE-727 A.3
-- =====================================================================
--
-- ★ Verificación de duplicados (DB local, corrió OK — 0 filas):
--   SELECT table_id, count(*) FROM table_sessions
--   WHERE closed_at IS NULL GROUP BY 1 HAVING count(*) > 1;
--   Resultado: 0 filas → no hay bloqueo. (2 sesiones abiertas en mesas distintas)
--
-- ★ Decisión DB-16 (documentada): NO se crea @@index([order_id, closed_at]).
--   El plan (A.7) prefiere resolver la sesión con `findFirst` top-level (pasa
--   por el scoping) en lugar del índice; registrado aquí y en el reporte.
--   Si A.7 cambia de opinión, se agrega como migración propia.

CREATE UNIQUE INDEX IF NOT EXISTS "table_sessions_one_open_per_table"
  ON "table_sessions"("table_id") WHERE "closed_at" IS NULL;
