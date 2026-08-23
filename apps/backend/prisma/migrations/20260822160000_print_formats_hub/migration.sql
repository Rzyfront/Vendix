-- DATA IMPACT:
-- Tables affected: print_templates, store_print_format_configs
-- Expected row changes: NONE. Migracion puramente aditiva que crea un nuevo enum y dos nuevas tablas con sus indices y llaves foraneas.
-- Destructive operations: none
-- FK/cascade risk: seguro (ON DELETE CASCADE para store/org, ON DELETE SET NULL para template_id y created_by)
-- Idempotency: CREATE TYPE / CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS

-- 1. Crear Enum print_format_type_enum si no existe
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'print_format_type_enum') THEN
    CREATE TYPE "print_format_type_enum" AS ENUM (
      'pos_sale_ticket',
      'sales_order_invoice',
      'dispatch_note',
      'quotation',
      'credit_note',
      'purchase_order',
      'transfer_note',
      'fiscal_electronic_invoice',
      'fiscal_credit_note',
      'kitchen_ticket'
    );
  END IF;
END $$;

-- 2. Crear tabla print_templates (Biblioteca y Plantillas Maestras del Sistema)
CREATE TABLE IF NOT EXISTS "print_templates" (
  "id" SERIAL PRIMARY KEY,
  "organization_id" INTEGER,
  "format_type" "print_format_type_enum" NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(255),
  "definition" JSONB NOT NULL,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "is_shared" BOOLEAN NOT NULL DEFAULT false,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_print_templates_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_print_templates_author" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

-- Indices para print_templates
CREATE INDEX IF NOT EXISTS "idx_print_templates_org_format" ON "print_templates" ("organization_id", "format_type");
CREATE INDEX IF NOT EXISTS "idx_print_templates_system_format" ON "print_templates" ("is_system", "format_type");
CREATE INDEX IF NOT EXISTS "idx_print_templates_shared_org" ON "print_templates" ("is_shared", "organization_id");

-- 3. Crear tabla store_print_format_configs (Configuraciones activas y overrides por tienda)
CREATE TABLE IF NOT EXISTS "store_print_format_configs" (
  "id" SERIAL PRIMARY KEY,
  "store_id" INTEGER NOT NULL,
  "organization_id" INTEGER NOT NULL,
  "format_type" "print_format_type_enum" NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "gateway_enabled" BOOLEAN NOT NULL DEFAULT false,
  "template_id" INTEGER,
  "overrides" JSONB,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uq_store_print_format_configs_store_type" UNIQUE ("store_id", "format_type"),
  CONSTRAINT "fk_store_print_format_configs_store" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_store_print_format_configs_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_store_print_format_configs_template" FOREIGN KEY ("template_id") REFERENCES "print_templates"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

-- Indices para store_print_format_configs
CREATE INDEX IF NOT EXISTS "idx_store_print_format_configs_store_active" ON "store_print_format_configs" ("store_id", "is_active");
CREATE INDEX IF NOT EXISTS "idx_store_print_format_configs_org_format" ON "store_print_format_configs" ("organization_id", "format_type");
