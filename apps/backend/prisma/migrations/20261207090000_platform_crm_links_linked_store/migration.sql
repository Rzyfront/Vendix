-- Vendix Platform · el prospecto del CRM se enlaza con la organización cliente
-- entera (como hoy) o con UNA tienda concreta de esa organización.
--
-- DATA IMPACT:
--   Tables affected: platform_crm_links (1 columna NUEVA nullable, 1 FK nueva,
--   1 índice único parcial nuevo, 1 índice único parcial redefinido, 1 trigger
--   nuevo). Ninguna otra tabla.
--   Expected row changes: 0 INSERT, 0 UPDATE, 0 DELETE. Las filas existentes
--   quedan con linked_store_id = NULL: enlace a la organización entera, igual
--   que antes de esta migración.
--   Destructive operations: ninguna sobre datos. Sin DROP TABLE/COLUMN, UPDATE,
--   DELETE ni TRUNCATE. El índice platform_crm_links_one_active_per_organization
--   se redefine (DROP INDEX + CREATE dentro de UN bloque DO, atómico) para que
--   cuente solo los enlaces a la org entera: todas las filas actuales tienen
--   linked_store_id NULL, así que el índice nuevo cubre exactamente las mismas
--   filas que el anterior y no puede fallar por duplicados.
--   FK/cascade risk: linked_store_id → stores ON DELETE RESTRICT. Ninguna CASCADE.
--   Idempotency: ADD COLUMN IF NOT EXISTS, FK por pg_constraint, el índice de
--   la org solo se redefine si su definición aún no filtra linked_store_id,
--   CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION/TRIGGER. Aplicarla
--   dos veces no falla ni cambia nada.
--   Approval: brief de Rafael del 2026-11-19 (hotfix buscador CRM Vendix
--   Platform: enlazar a organización o a tienda).

-- 1. Columna: tienda concreta del enlace. NULL = la organización entera.
ALTER TABLE "platform_crm_links" ADD COLUMN IF NOT EXISTS "linked_store_id" INTEGER;

-- 2. Llave foránea (RESTRICT: una tienda enlazada no se borra en silencio).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_crm_links_linked_store_id_fkey') THEN
    ALTER TABLE "platform_crm_links" ADD CONSTRAINT "platform_crm_links_linked_store_id_fkey"
      FOREIGN KEY ("linked_store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- 3. Únicos PARCIALES (solo migración; Prisma no los expresa).
-- Una organización tiene un solo prospecto activo cuando el enlace es a la org
-- entera; los enlaces a una tienda quedan fuera de ese índice.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'platform_crm_links'
      AND indexname = 'platform_crm_links_one_active_per_organization'
      AND indexdef LIKE '%linked_store_id IS NULL%'
  ) THEN
    DROP INDEX IF EXISTS "platform_crm_links_one_active_per_organization";
    CREATE UNIQUE INDEX "platform_crm_links_one_active_per_organization"
      ON "platform_crm_links"("organization_id")
      WHERE "status" = 'linked' AND "linked_store_id" IS NULL;
  END IF;
END $$;

-- Una tienda tiene un solo prospecto activo.
CREATE UNIQUE INDEX IF NOT EXISTS "platform_crm_links_one_active_per_linked_store"
  ON "platform_crm_links"("linked_store_id")
  WHERE "status" = 'linked' AND "linked_store_id" IS NOT NULL;

-- 4. La base rechaza un enlace a una tienda que no sea de la organización
-- enlazada, o que sea de la organización plataforma, aunque un bug del código
-- lo intente. Trigger aparte del candado de 20261204090000 para no reescribir
-- su función. Solo mira INSERT y cambios de tienda/organización: desenlazar
-- (UPDATE de status) nunca queda bloqueado por él.
CREATE OR REPLACE FUNCTION "platform_crm_links_assert_linked_store"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."linked_store_id" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "stores" s
    JOIN "organizations" o ON o."id" = s."organization_id"
    WHERE s."id" = NEW."linked_store_id"
      AND s."organization_id" = NEW."organization_id"
      AND o."is_platform" = FALSE
  ) THEN
    RAISE EXCEPTION 'platform_crm_links: linked store % does not belong to client organization %',
      NEW."linked_store_id", NEW."organization_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER "platform_crm_links_linked_store_guard"
  BEFORE INSERT OR UPDATE OF "linked_store_id", "organization_id" ON "platform_crm_links"
  FOR EACH ROW EXECUTE FUNCTION "platform_crm_links_assert_linked_store"();
