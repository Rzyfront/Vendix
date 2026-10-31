-- DATA IMPACT:
-- Tables affected: cash_register_movements (se agregan DOS columnas nullable y un indice unico parcial; no muta filas).
-- Expected row changes: none. Las filas existentes quedan con source_type/source_id = NULL y
--   el indice parcial (WHERE source_id IS NOT NULL) no las cubre.
-- Destructive operations: none (sin DROP/DELETE/TRUNCATE/UPDATE).
-- FK/cascade risk: none (sin FKs nuevas).
-- Idempotency: ADD COLUMN IF NOT EXISTS y el indice dentro de un bloque DO (solo se crea si no hay duplicados).
--
-- Contexto (caja B04): el dinero en efectivo de separados, cuentas por cobrar y anticipos deja un
-- cash_in/cash_out con su origen (source_type, source_id). El indice hace idempotente el reintento.

ALTER TABLE "cash_register_movements" ADD COLUMN IF NOT EXISTS "source_type" VARCHAR(40);
ALTER TABLE "cash_register_movements" ADD COLUMN IF NOT EXISTS "source_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'cash_register_movements_source_uq'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM "cash_register_movements"
      WHERE "source_id" IS NOT NULL
      GROUP BY "store_id", "source_type", "source_id", "type"
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'cash_register_movements_source_uq omitido: hay duplicados (store_id, source_type, source_id, type)';
    ELSE
      CREATE UNIQUE INDEX "cash_register_movements_source_uq"
        ON "cash_register_movements" ("store_id", "source_type", "source_id", "type")
        WHERE "source_id" IS NOT NULL;
    END IF;
  END IF;
END $$;
