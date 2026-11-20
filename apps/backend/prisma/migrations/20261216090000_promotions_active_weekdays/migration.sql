-- Promociones por días de la semana (restaurantes y nichos con días de alta
-- concurrencia): una promoción puede limitarse a ciertos días.
--
-- DATA IMPACT:
--   Tables affected:
--     promotions: 1 columna nueva `active_weekdays INTEGER[]` con default
--       ARRAY[]::INTEGER[] y 1 CHECK de rango (0..6).
--   Semántica: 0 = domingo … 6 = sábado (convención de Date#getDay / Intl),
--     evaluado en la zona horaria de la tienda. Arreglo vacío = todos los días.
--   Expected row changes: 0. No INSERT/UPDATE/DELETE. PostgreSQL rellena las
--     filas existentes con el default vacío, es decir "todos los días": las
--     promociones actuales se comportan exactamente igual que antes.
--   Destructive operations: none.
--   FK/cascade risk: none (sin FKs nuevas).
--   Idempotency: ADD COLUMN IF NOT EXISTS y CHECK guardado por pg_constraint.
--     Re-ejecutarla es un no-op.
--   Approval: encargo de Rafael "promociones por días de la semana"
--     (odd/tasks/promociones-auditoria-dias-semana.md).

ALTER TABLE "promotions"
  ADD COLUMN IF NOT EXISTS "active_weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'promotions_active_weekdays_range_chk'
  ) THEN
    ALTER TABLE "promotions"
      ADD CONSTRAINT "promotions_active_weekdays_range_chk"
      CHECK ("active_weekdays" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[]);
  END IF;
END $$;
