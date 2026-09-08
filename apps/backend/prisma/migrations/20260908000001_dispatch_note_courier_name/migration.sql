-- Domiciliario de la entrega rapida (plan docs/plans/despacho-rapido-domiciliario.md, pasos 1-3).
-- El boton "Entrega completa" pide el nombre del domiciliario (solo nombre, sin
-- cedula) y lo guarda en la remision para que quede registrado y reimprimible
-- en el tiquete de despacho.
--
-- DATA IMPACT:
-- Tables affected:
--   · dispatch_notes — 1 columna AGREGADA (`courier_name`, nullable, sin DEFAULT)
-- Expected row changes: 0 filas leidas, 0 filas mutadas. Toda remision existente
--   queda con `courier_name = NULL` (sin domiciliario registrado, que es el estado
--   correcto del historico) y el ticket no pinta la linea cuando es NULL.
-- Destructive operations: NINGUNA. Solo ADD COLUMN. Sin DROP TABLE/COLUMN,
--   sin TRUNCATE, sin CASCADE, sin DELETE, sin UPDATE, sin backfill.
-- FK/cascade risk: ninguno — la columna no es FK y no crea constraints.
-- Idempotency: ADD COLUMN con IF NOT EXISTS (DO guardado por
--   information_schema). Reejecutable.
-- Approval: plan despacho-rapido-domiciliario aprobado (backend pasos 1-3).
-- Rollback: DROP COLUMN "courier_name" (solo si ningun codigo la lee/escribe).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dispatch_notes' AND column_name = 'courier_name'
  ) THEN
    ALTER TABLE "dispatch_notes" ADD COLUMN "courier_name" VARCHAR(255);
  END IF;
END $$;
