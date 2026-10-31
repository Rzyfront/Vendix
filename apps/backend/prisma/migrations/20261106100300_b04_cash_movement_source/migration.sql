-- DATA IMPACT:
-- Tables affected: cash_register_movements (se agregan DOS columnas nullable y un indice unico parcial; no muta filas).
-- Expected row changes: none. Las filas existentes quedan con source_type/source_id = NULL y
--   el indice parcial (WHERE source_id IS NOT NULL) no las cubre.
-- Destructive operations: none (sin DROP/DELETE/TRUNCATE/UPDATE).
-- FK/cascade risk: none (sin FKs nuevas).
-- Idempotency: ADD COLUMN IF NOT EXISTS y el indice dentro de un bloque DO.
-- Duplicados: si existieran (store_id, source_type, source_id, type) repetidos, la migracion FALLA
--   (RAISE EXCEPTION con el detalle) en vez de quedar aplicada sin el indice. En un primer deploy
--   las columnas nacen NULL y no puede haber duplicados.
--
-- Contexto (caja B04): el dinero en efectivo de separados, cuentas por cobrar y anticipos deja un
-- cash_in/cash_out con su origen (source_type, source_id). El indice hace idempotente el reintento.

ALTER TABLE "cash_register_movements" ADD COLUMN IF NOT EXISTS "source_type" VARCHAR(40);
ALTER TABLE "cash_register_movements" ADD COLUMN IF NOT EXISTS "source_id" INTEGER;

DO $$
DECLARE
  dupes TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = current_schema()
       AND indexname = 'cash_register_movements_source_uq'
  ) THEN
    SELECT string_agg(format('store_id=%s %s#%s type=%s filas=%s', store_id, source_type, source_id, type, n), '; ')
      INTO dupes
      FROM (
        SELECT "store_id", "source_type", "source_id", "type", COUNT(*) AS n
          FROM "cash_register_movements"
         WHERE "source_id" IS NOT NULL
         GROUP BY "store_id", "source_type", "source_id", "type"
        HAVING COUNT(*) > 1
         ORDER BY 1, 2, 3, 4
         LIMIT 50
      ) d;
    IF dupes IS NOT NULL THEN
      RAISE EXCEPTION 'cash_register_movements_source_uq NO creado: duplicados (store_id, source_type, source_id, type): %', dupes
        USING HINT = 'Resolver con ajuste (nunca borrado), marcar la migracion --rolled-back y redesplegar.';
    END IF;
    CREATE UNIQUE INDEX "cash_register_movements_source_uq"
      ON "cash_register_movements" ("store_id", "source_type", "source_id", "type")
      WHERE "source_id" IS NOT NULL;
  END IF;
END $$;
