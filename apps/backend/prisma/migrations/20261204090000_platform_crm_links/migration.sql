-- Vendix Platform · enlace prospecto CRM ↔ organización cliente
-- (odd/tasks/vendix-platform-crm-enlace.md §2-§3).
--
-- DATA IMPACT:
--   Tables affected: 1 tabla NUEVA (platform_crm_links) + 1 enum nuevo
--   (platform_crm_link_status_enum). Filas nuevas, nunca modificadas:
--     - permissions: 2 filas (platform:crm_link:manage, platform:crm_link:read)
--       con is_system_permission = TRUE.
--     - roles: 1 fila "Comercial Vendix" por cada organización is_platform = TRUE
--       (prod: solo la org 1). 0 filas si no existe org plataforma.
--     - role_permissions: 2 filas (el rol anterior × los 2 permisos).
--   Expected row changes: 0 UPDATE, 0 DELETE. Solo INSERT ... ON CONFLICT DO NOTHING.
--   Destructive operations: ninguna. Sin DROP, UPDATE, DELETE ni TRUNCATE.
--   Columnas de tablas existentes: ninguna se agrega ni se modifica.
--   FK/cascade risk: todas las FKs de la tabla nueva son RESTRICT, salvo
--   unlinked_by_user_id (SET NULL). Ninguna CASCADE.
--   Idempotency: enum por pg_type, CREATE TABLE/INDEX IF NOT EXISTS, FKs por
--   pg_constraint, CREATE OR REPLACE FUNCTION/TRIGGER, INSERT ON CONFLICT DO
--   NOTHING. Aplicarla dos veces no falla ni duplica filas.
--   Approval: plan aprobado por Rafael (2026-11-17), decisión D1 (trigger SÍ)
--   y D4 (rol "Comercial Vendix").

-- 1. Enum de estado del enlace
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'platform_crm_link_status_enum') THEN
    CREATE TYPE "platform_crm_link_status_enum" AS ENUM ('linked', 'unlinked');
  END IF;
END $$;

-- 2. Tabla
CREATE TABLE IF NOT EXISTS "platform_crm_links" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "status" "platform_crm_link_status_enum" NOT NULL DEFAULT 'linked',
    "note" VARCHAR(300),
    "linked_by_user_id" INTEGER NOT NULL,
    "linked_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlinked_by_user_id" INTEGER,
    "unlinked_at" TIMESTAMP(6),

    CONSTRAINT "platform_crm_links_pkey" PRIMARY KEY ("id")
);

-- 3. Índices (los dos primeros los declara schema.prisma)
CREATE INDEX IF NOT EXISTS "platform_crm_links_store_id_customer_id_idx" ON "platform_crm_links"("store_id", "customer_id");
CREATE INDEX IF NOT EXISTS "platform_crm_links_organization_id_idx" ON "platform_crm_links"("organization_id");

-- Únicos PARCIALES (solo migración; Prisma no los expresa): un cliente tiene un
-- solo enlace activo y una organización un solo prospecto activo. El historial
-- de desenlaces (status = 'unlinked') queda fuera del índice y se conserva.
CREATE UNIQUE INDEX IF NOT EXISTS "platform_crm_links_one_active_per_customer"
  ON "platform_crm_links"("customer_id") WHERE "status" = 'linked';
CREATE UNIQUE INDEX IF NOT EXISTS "platform_crm_links_one_active_per_organization"
  ON "platform_crm_links"("organization_id") WHERE "status" = 'linked';

-- 4. Llaves foráneas (RESTRICT; SET NULL solo en quien desenlazó)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_crm_links_store_id_fkey') THEN
    ALTER TABLE "platform_crm_links" ADD CONSTRAINT "platform_crm_links_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_crm_links_customer_id_fkey') THEN
    ALTER TABLE "platform_crm_links" ADD CONSTRAINT "platform_crm_links_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_crm_links_organization_id_fkey') THEN
    ALTER TABLE "platform_crm_links" ADD CONSTRAINT "platform_crm_links_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_crm_links_linked_by_user_id_fkey') THEN
    ALTER TABLE "platform_crm_links" ADD CONSTRAINT "platform_crm_links_linked_by_user_id_fkey"
      FOREIGN KEY ("linked_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_crm_links_unlinked_by_user_id_fkey') THEN
    ALTER TABLE "platform_crm_links" ADD CONSTRAINT "platform_crm_links_unlinked_by_user_id_fkey"
      FOREIGN KEY ("unlinked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- 5. Candado 6: la base rechaza cualquier fila cuya tienda no pertenezca a una
-- organización is_platform, aunque un bug del código lo intente.
CREATE OR REPLACE FUNCTION "platform_crm_links_assert_platform_store"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "stores" s
    JOIN "organizations" o ON o."id" = s."organization_id"
    WHERE s."id" = NEW."store_id" AND o."is_platform" = TRUE
  ) THEN
    RAISE EXCEPTION 'platform_crm_links: store % does not belong to the platform organization', NEW."store_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER "platform_crm_links_platform_store_guard"
  BEFORE INSERT OR UPDATE ON "platform_crm_links"
  FOR EACH ROW EXECUTE FUNCTION "platform_crm_links_assert_platform_store"();

-- 6. Permisos de sistema (no asignables por organizaciones: ORG_PERM_001)
INSERT INTO "permissions" ("name", "description", "path", "method", "status", "is_system_permission", "created_at", "updated_at")
VALUES
  ('platform:crm_link:manage',
   'Vendix Platform: enlazar y desenlazar prospectos del CRM con organizaciones cliente',
   '/api/store/platform-crm/customers/:customerId/link', 'POST', 'active', TRUE,
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('platform:crm_link:read',
   'Vendix Platform: ver la cuenta Vendix enlazada a un prospecto del CRM',
   '/api/store/platform-crm/customers/:customerId/link', 'GET', 'active', TRUE,
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- 7. Rol "Comercial Vendix" de la org plataforma (org-wide, no de sistema)
INSERT INTO "roles" ("name", "description", "is_system_role", "organization_id", "store_id", "created_at", "updated_at")
SELECT 'Comercial Vendix',
       'Equipo comercial de Vendix: enlaza prospectos del CRM con organizaciones cliente',
       FALSE, o."id", NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "organizations" o
WHERE o."is_platform" = TRUE
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "granted", "created_at")
SELECT r."id", p."id", TRUE, CURRENT_TIMESTAMP
FROM "roles" r
JOIN "organizations" o ON o."id" = r."organization_id" AND o."is_platform" = TRUE
JOIN "permissions" p ON p."name" IN ('platform:crm_link:manage', 'platform:crm_link:read')
WHERE r."name" = 'Comercial Vendix' AND r."store_id" IS NULL
ON CONFLICT DO NOTHING;
