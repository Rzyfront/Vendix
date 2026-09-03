-- =====================================================================
-- Migration: kitchen_ticket_table_fk (CP-POLLO-ARABE-727 A.3)
-- Purpose: Declarar la FK de `kitchen_tickets.table_id` → `tables(id)`.
--          La COLUMNA table_id YA EXISTE (schema.prisma, creada en
--          20260613000000_restaurant_suite_foundation) pero nunca se le puso
--          FK ni se pobló. Esta migración SOLO agrega el constraint + índice.
-- =====================================================================
--
-- DATA IMPACT:
--   Tables affected: kitchen_tickets (schema-only, ADD CONSTRAINT)
--   Rows mutated:    NONE
--   Destructive operations: none
--   FK/cascade risk: table_id -> tables(id) ON DELETE SET NULL (si la mesa se
--                    borra, el ticket queda con table_id NULL; nunca se borra
--                    retroactivamente)
--   Idempotency: ADD CONSTRAINT guardado con EXCEPTION WHEN duplicate_object +
--                CREATE INDEX IF NOT EXISTS
--   Approval: CP-POLLO-ARABE-727 A.3
-- =====================================================================
--
-- ★ ADVERTENCIA: NUNCA ADD COLUMN aquí. `table_id` ya existe; un ADD COLUMN
--   adicional fallaría el deploy por columna duplicada.

-- Índice parcial: solo indexa tickets ligados a una mesa.
CREATE INDEX IF NOT EXISTS "kitchen_tickets_table_idx"
  ON "kitchen_tickets"("table_id") WHERE "table_id" IS NOT NULL;

DO $$
BEGIN
  BEGIN
    ALTER TABLE "kitchen_tickets"
      ADD CONSTRAINT "kitchen_tickets_table_id_fkey"
      FOREIGN KEY ("table_id") REFERENCES "tables"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END
$$;
