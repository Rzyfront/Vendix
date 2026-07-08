-- DATA IMPACT:
-- Tables affected:
--   membership_access_credentials -> is_active (desactivar duplicados activos)
-- Expected row changes: proporcional a la cantidad de socios con 2+ credenciales
--   activas del mismo (credential_type) para la misma (store_id, customer_id).
--   En un dataset limpio (sin duplicados activos) el UPDATE es no-op.
-- Destructive operations: NINGUNA. No se hace DELETE, TRUNCATE ni DROP.
--   La unica mutacion es UPDATE ... SET is_active = false, preservando el historial
--   (las credenciales desactivadas siguen existiendo y siguen siendo consultables
--   para bitacora; el partial unique index solo afecta is_active = true).
-- FK/cascade risk: ninguno. membership_access_credentials no tiene FKs entrantes
--   que dependan de is_active (los logs referencian por credential_id pero no
--   filtran por is_active; desactivar no rompe la bitacora historica).
-- Idempotency: el UPDATE es idempotente (solo afecta filas con is_active = true
--   que NO son el max(id) por grupo; una segunda ejecucion no encuentra candidatas
--   y es no-op). El CREATE UNIQUE INDEX usa IF NOT EXISTS.
-- Approval: pendiente de aprobacion explicita del usuario para deploy a prod,
--   acompanado de snapshot de prod (regla inviolable `feedback_no_destructive_migrations`).
--   Patron de backfill calcado de
--   20260707232555_backfill_user_store_invariants/migration.sql.
-- Referencia plan: Anotacion 2a (webpage-annotations-rustling-waffle.md, lineas 49-66).
-- Prisma: el partial unique index vive SOLO en esta migracion SQL. Prisma no soporta
--   `WHERE` en @@unique declarado y declarar @@index lo dropearia en futuras
--   migraciones. El @@unique([store_id, credential_type, credential_value]) ya
--   existente en schema.prisma (linea 3394) se mantiene sin cambios.

-- =====================================================================
-- STEP 1: Desactivar duplicados activos, dejando el mas reciente (max id)
--   por grupo (store_id, customer_id, credential_type). Solo afecta filas
--   actualmente activas; las inactivas (is_active = false) se ignoran
--   para no perturbar el historial.
--   Idempotente: una segunda corrida encuentra 0 candidatos y no hace nada.
-- =====================================================================
UPDATE membership_access_credentials mac
SET is_active = false
WHERE mac.is_active = true
  AND mac.id NOT IN (
    SELECT max(id) FROM membership_access_credentials
    WHERE is_active = true
    GROUP BY store_id, customer_id, credential_type
  );

-- =====================================================================
-- STEP 2: Crear partial unique index. Solo aplica a filas con
--   is_active = true, permitiendo multiples credenciales inactivas
--   del mismo (store, customer, type) para preservar historial
--   (regenerar = desactivar vieja + crear nueva).
--   IF NOT EXISTS garantiza idempotencia en re-aplicacion.
-- =====================================================================
CREATE UNIQUE INDEX IF NOT EXISTS membership_access_cred_active_uq
  ON membership_access_credentials (store_id, customer_id, credential_type)
  WHERE is_active = true;
