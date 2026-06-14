-- =====================================================================
-- Restaurant Suite Foundation (Fase A)
-- =====================================================================
-- DATA IMPACT:
-- Tables affected:
--   - products                         (additive: 7 new columns with server-side
--                                       defaults; existing rows backfill atomically
--                                       via ALTER TABLE ADD COLUMN DEFAULT)
--   - 11 NEW tables created (all with explicit store_id FK):
--       recipes
--       recipe_items
--       production_orders
--       tables
--       table_sessions
--       kitchen_tickets
--       kitchen_ticket_items
--       menus
--       menu_sections
--       menu_section_items
--       menu_availability_windows
--   - 4 enums extended:
--       product_type_enum              (+ 'prepared')
--       movement_type_enum             (+ 'production', 'consumption')
--       production_order_state_enum    (NEW)
--       table_status_enum              (NEW)
--       kitchen_ticket_state_enum      (NEW)
--       kitchen_ticket_item_state_enum (NEW)
--
-- Expected row changes: 0 destructive mutations.
--   - ALTER TABLE ADD COLUMN with server-side DEFAULTs backfills existing
--     products rows in-place atomically (no UPDATE issued).
--   - 4 enum value additions do not rewrite any column.
--   - 11 new tables are empty until Fase B logic writes to them.
-- Destructive operations: none.
--   - No DROP, TRUNCATE, DELETE, UPDATE (without WHERE).
--   - No FK changes on existing tables.
-- FK/cascade risk: minimal.
--   - All new tables have explicit FKs with onDelete chosen to be safe for
--     a fresh, empty table:
--       * recipe_items → recipes             ON DELETE CASCADE
--         (recipe_items are a child of the recipe header; deleting the
--          recipe header logically removes its lines)
--       * kitchen_ticket_items → kitchen_tickets ON DELETE CASCADE
--         (per-item state is a child of the ticket)
--       * menus → stores                    ON DELETE NO ACTION (parent
--         store is the tenant anchor; we never cascade-delete from store)
--       * menu_sections → menus             ON DELETE CASCADE
--         (sections are children of a menu)
--       * menu_section_items → menu_sections ON DELETE CASCADE
--       * menu_availability_windows → menus / menu_sections ON DELETE CASCADE
--       * All other FKs ON DELETE RESTRICT / NO ACTION (parent deletes are
--         blocked so business data is never lost).
-- Idempotency:
--   - Enum extension uses ALTER TYPE ... ADD VALUE IF NOT EXISTS.
--   - CREATE TYPE for new enums is guarded by pg_type lookup (DO $$).
--   - CREATE TABLE uses IF NOT EXISTS.
--   - ADD COLUMN uses IF NOT EXISTS.
--   - CREATE INDEX / CREATE UNIQUE INDEX use IF NOT EXISTS.
--   - All FKs added via DO $$ ... pg_constraint lookup so re-runs are no-ops.
-- Reversibility:
--   - DROP TABLE for the 11 new tables.
--   - DROP COLUMN for the 7 new products columns.
--   - PostgreSQL does NOT support DROP VALUE from a CREATE TYPE enum
--     directly. To roll back the enum extensions, recreate the type
--     without the new values. The new values are not used by any
--     persisted row in Fase A, so a type recreation is safe.
-- Approval: Phase A of mega-plan logical-herding-meteor.md (Restaurant
-- Suite Foundation). No production row mutation. All additive.
-- =====================================================================

-- =====================================================================
-- 1. Enum extensions (additive)
-- =====================================================================

-- product_type_enum: add 'prepared' for in-house prepared food/beverage
-- (restaurant suite). 'physical' and 'service' are unchanged.
ALTER TYPE "product_type_enum" ADD VALUE IF NOT EXISTS 'prepared';

-- movement_type_enum: add 'production' (finished good created by a
-- production run) and 'consumption' (ingredient consumed by a recipe
-- explosion). All previous values are unchanged.
ALTER TYPE "movement_type_enum" ADD VALUE IF NOT EXISTS 'production';
ALTER TYPE "movement_type_enum" ADD VALUE IF NOT EXISTS 'consumption';

-- 4 brand new enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_order_state_enum') THEN
    CREATE TYPE "production_order_state_enum" AS ENUM (
      'draft',
      'in_progress',
      'completed',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'table_status_enum') THEN
    CREATE TYPE "table_status_enum" AS ENUM (
      'available',
      'occupied',
      'reserved',
      'cleaning'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kitchen_ticket_state_enum') THEN
    CREATE TYPE "kitchen_ticket_state_enum" AS ENUM (
      'pending',
      'in_preparation',
      'ready',
      'delivered',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kitchen_ticket_item_state_enum') THEN
    CREATE TYPE "kitchen_ticket_item_state_enum" AS ENUM (
      'pending',
      'in_preparation',
      'ready',
      'delivered',
      'cancelled'
    );
  END IF;
END $$;

-- =====================================================================
-- 2. Products — 7 new additive columns
-- =====================================================================
-- Existing products keep current behavior because the new columns have
-- server-side defaults that preserve retail semantics:
--   is_sellable=true       (catalog visibility unchanged)
--   is_ingredient=false    (raw-material signal; not active in retail)
--   is_combo=false         (combo flag; not active in retail)
--   is_batch_produced=false(production-run signal; not active in retail)
--   stock_unit / purchase_unit / purchase_to_stock_factor are NULLABLE
--     (backward compatible for non-restaurant stores)

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "is_sellable" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "is_ingredient" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "is_combo" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "is_batch_produced" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "stock_unit" VARCHAR(20);

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "purchase_unit" VARCHAR(20);

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "purchase_to_stock_factor" INTEGER;

-- Helpful composite index for catalog filtering: products of a store that
-- are sellable in the current industry (restaurant vs retail). Pre-filtering
-- on is_sellable is the most common catalog query path.
CREATE INDEX IF NOT EXISTS "products_store_sellable_idx"
  ON "products" ("store_id", "is_sellable");

-- Index to support ingredient lookup (recipe component resolution).
CREATE INDEX IF NOT EXISTS "products_store_ingredient_idx"
  ON "products" ("store_id", "is_ingredient");

-- =====================================================================
-- 3. New tables — 11 models
-- =====================================================================

-- ---------------------------------------------------------------------
-- 3.1 recipes (1 product → 1 recipe, UNIQUE on product_id)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "recipes" (
  "id"                  SERIAL PRIMARY KEY,
  "store_id"            INTEGER NOT NULL,
  "product_id"          INTEGER NOT NULL,
  "yield_quantity"      DECIMAL(12, 4) NOT NULL,
  "yield_unit"          VARCHAR(20) NOT NULL,
  "waste_percent"       DECIMAL(5, 2) NOT NULL DEFAULT 0,
  "preparation_notes"   TEXT,
  "is_active"           BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"          TIMESTAMP(6) DEFAULT now(),
  "updated_at"          TIMESTAMP(6) DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "recipes_product_id_key"
  ON "recipes" ("product_id");

CREATE INDEX IF NOT EXISTS "recipes_store_active_idx"
  ON "recipes" ("store_id", "is_active");

-- FK: store
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recipes_store_id_fkey'
  ) THEN
    ALTER TABLE "recipes"
      ADD CONSTRAINT "recipes_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- FK: product (UNIQUE on product_id above acts as the uniqueness target;
-- Restrict is the safest default — recipes follow the product).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recipes_product_id_fkey'
  ) THEN
    ALTER TABLE "recipes"
      ADD CONSTRAINT "recipes_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3.2 recipe_items (recipe header → components)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "recipe_items" (
  "id"                    SERIAL PRIMARY KEY,
  "recipe_id"             INTEGER NOT NULL,
  "component_product_id"  INTEGER NOT NULL,
  "quantity"              DECIMAL(12, 4) NOT NULL,
  "waste_percent"         DECIMAL(5, 2) NOT NULL DEFAULT 0,
  "is_optional"           BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at"            TIMESTAMP(6) DEFAULT now(),
  "updated_at"            TIMESTAMP(6) DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "recipe_items_recipe_component_key"
  ON "recipe_items" ("recipe_id", "component_product_id");

CREATE INDEX IF NOT EXISTS "recipe_items_component_product_idx"
  ON "recipe_items" ("component_product_id");

-- FK: recipe (CASCADE — items are children of the recipe header)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recipe_items_recipe_id_fkey'
  ) THEN
    ALTER TABLE "recipe_items"
      ADD CONSTRAINT "recipe_items_recipe_id_fkey"
      FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- FK: component_product
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recipe_items_component_product_id_fkey'
  ) THEN
    ALTER TABLE "recipe_items"
      ADD CONSTRAINT "recipe_items_component_product_id_fkey"
      FOREIGN KEY ("component_product_id") REFERENCES "products"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3.3 production_orders
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "production_orders" (
  "id"            SERIAL PRIMARY KEY,
  "store_id"      INTEGER NOT NULL,
  "product_id"    INTEGER NOT NULL,
  "recipe_id"     INTEGER NOT NULL,
  "planned_qty"   DECIMAL(12, 4) NOT NULL,
  "produced_qty"  DECIMAL(12, 4),
  "status"        "production_order_state_enum" NOT NULL DEFAULT 'draft',
  "produced_at"   TIMESTAMP(6),
  "created_at"    TIMESTAMP(6) DEFAULT now(),
  "updated_at"    TIMESTAMP(6) DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "production_orders_store_status_idx"
  ON "production_orders" ("store_id", "status");

CREATE INDEX IF NOT EXISTS "production_orders_store_product_idx"
  ON "production_orders" ("store_id", "product_id");

CREATE INDEX IF NOT EXISTS "production_orders_store_created_idx"
  ON "production_orders" ("store_id", "created_at");

-- FK: store
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'production_orders_store_id_fkey'
  ) THEN
    ALTER TABLE "production_orders"
      ADD CONSTRAINT "production_orders_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- FK: product
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'production_orders_product_id_fkey'
  ) THEN
    ALTER TABLE "production_orders"
      ADD CONSTRAINT "production_orders_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- FK: recipe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'production_orders_recipe_id_fkey'
  ) THEN
    ALTER TABLE "production_orders"
      ADD CONSTRAINT "production_orders_recipe_id_fkey"
      FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3.4 tables (restaurant floor)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "tables" (
  "id"         SERIAL PRIMARY KEY,
  "store_id"   INTEGER NOT NULL,
  "name"       VARCHAR(100) NOT NULL,
  "zone"       VARCHAR(100),
  "capacity"   INTEGER,
  "status"     "table_status_enum" NOT NULL DEFAULT 'available',
  "pos_x"      INTEGER,
  "pos_y"      INTEGER,
  "created_at" TIMESTAMP(6) DEFAULT now(),
  "updated_at" TIMESTAMP(6) DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "tables_store_name_key"
  ON "tables" ("store_id", "name");

CREATE INDEX IF NOT EXISTS "tables_store_status_idx"
  ON "tables" ("store_id", "status");

CREATE INDEX IF NOT EXISTS "tables_store_zone_idx"
  ON "tables" ("store_id", "zone");

-- FK: store
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tables_store_id_fkey'
  ) THEN
    ALTER TABLE "tables"
      ADD CONSTRAINT "tables_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3.5 table_sessions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "table_sessions" (
  "id"           SERIAL PRIMARY KEY,
  "store_id"     INTEGER NOT NULL,
  "table_id"     INTEGER NOT NULL,
  "order_id"     INTEGER NOT NULL,
  "opened_by"    INTEGER NOT NULL,
  "opened_at"    TIMESTAMP(6) NOT NULL DEFAULT now(),
  "closed_at"    TIMESTAMP(6),
  "guest_count"  INTEGER,
  "created_at"   TIMESTAMP(6) DEFAULT now(),
  "updated_at"   TIMESTAMP(6) DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "table_sessions_store_table_idx"
  ON "table_sessions" ("store_id", "table_id");

CREATE INDEX IF NOT EXISTS "table_sessions_store_order_idx"
  ON "table_sessions" ("store_id", "order_id");

CREATE INDEX IF NOT EXISTS "table_sessions_store_closed_idx"
  ON "table_sessions" ("store_id", "closed_at");

-- FK: store
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'table_sessions_store_id_fkey'
  ) THEN
    ALTER TABLE "table_sessions"
      ADD CONSTRAINT "table_sessions_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- FK: table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'table_sessions_table_id_fkey'
  ) THEN
    ALTER TABLE "table_sessions"
      ADD CONSTRAINT "table_sessions_table_id_fkey"
      FOREIGN KEY ("table_id") REFERENCES "tables"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- FK: order
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'table_sessions_order_id_fkey'
  ) THEN
    ALTER TABLE "table_sessions"
      ADD CONSTRAINT "table_sessions_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- FK: opener (staff user)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'table_sessions_opened_by_fkey'
  ) THEN
    ALTER TABLE "table_sessions"
      ADD CONSTRAINT "table_sessions_opened_by_fkey"
      FOREIGN KEY ("opened_by") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3.6 kitchen_tickets
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "kitchen_tickets" (
  "id"         SERIAL PRIMARY KEY,
  "store_id"   INTEGER NOT NULL,
  "order_id"   INTEGER NOT NULL,
  "table_id"   INTEGER,
  "status"     "kitchen_ticket_state_enum" NOT NULL DEFAULT 'pending',
  "fired_at"   TIMESTAMP(6) NOT NULL DEFAULT now(),
  "ready_at"   TIMESTAMP(6),
  "created_at" TIMESTAMP(6) DEFAULT now(),
  "updated_at" TIMESTAMP(6) DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "kitchen_tickets_store_status_idx"
  ON "kitchen_tickets" ("store_id", "status");

CREATE INDEX IF NOT EXISTS "kitchen_tickets_store_order_idx"
  ON "kitchen_tickets" ("store_id", "order_id");

CREATE INDEX IF NOT EXISTS "kitchen_tickets_store_fired_idx"
  ON "kitchen_tickets" ("store_id", "fired_at");

-- FK: store
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kitchen_tickets_store_id_fkey'
  ) THEN
    ALTER TABLE "kitchen_tickets"
      ADD CONSTRAINT "kitchen_tickets_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- FK: order
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kitchen_tickets_order_id_fkey'
  ) THEN
    ALTER TABLE "kitchen_tickets"
      ADD CONSTRAINT "kitchen_tickets_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- table_id is intentionally NOT a foreign key in this migration: the
-- tables table is new and tickets in legacy POS flows may pre-date
-- floor plan adoption. The relationship is still queryable via
-- table_sessions.order_id. A future migration can backfill an FK
-- constraint if/when all kitchen tickets are guaranteed to attach to a
-- known table.

-- ---------------------------------------------------------------------
-- 3.7 kitchen_ticket_items
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "kitchen_ticket_items" (
  "id"                  SERIAL PRIMARY KEY,
  "kitchen_ticket_id"   INTEGER NOT NULL,
  "order_item_id"       INTEGER NOT NULL,
  "product_id"          INTEGER NOT NULL,
  "quantity"            INTEGER NOT NULL,
  "status"              "kitchen_ticket_item_state_enum" NOT NULL DEFAULT 'pending',
  "notes"               TEXT,
  "created_at"          TIMESTAMP(6) DEFAULT now(),
  "updated_at"          TIMESTAMP(6) DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "kitchen_ticket_items_ticket_idx"
  ON "kitchen_ticket_items" ("kitchen_ticket_id");

CREATE INDEX IF NOT EXISTS "kitchen_ticket_items_order_item_idx"
  ON "kitchen_ticket_items" ("order_item_id");

CREATE INDEX IF NOT EXISTS "kitchen_ticket_items_product_idx"
  ON "kitchen_ticket_items" ("product_id");

CREATE INDEX IF NOT EXISTS "kitchen_ticket_items_status_idx"
  ON "kitchen_ticket_items" ("status");

-- FK: kitchen_ticket (CASCADE — items are children of the ticket)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kitchen_ticket_items_kitchen_ticket_id_fkey'
  ) THEN
    ALTER TABLE "kitchen_ticket_items"
      ADD CONSTRAINT "kitchen_ticket_items_kitchen_ticket_id_fkey"
      FOREIGN KEY ("kitchen_ticket_id") REFERENCES "kitchen_tickets"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- FK: order_item
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kitchen_ticket_items_order_item_id_fkey'
  ) THEN
    ALTER TABLE "kitchen_ticket_items"
      ADD CONSTRAINT "kitchen_ticket_items_order_item_id_fkey"
      FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- FK: product
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kitchen_ticket_items_product_id_fkey'
  ) THEN
    ALTER TABLE "kitchen_ticket_items"
      ADD CONSTRAINT "kitchen_ticket_items_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3.8 menus
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "menus" (
  "id"         SERIAL PRIMARY KEY,
  "store_id"   INTEGER NOT NULL,
  "name"       VARCHAR(100) NOT NULL,
  "is_active"  BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(6) DEFAULT now(),
  "updated_at" TIMESTAMP(6) DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "menus_store_name_key"
  ON "menus" ("store_id", "name");

CREATE INDEX IF NOT EXISTS "menus_store_active_idx"
  ON "menus" ("store_id", "is_active");

-- FK: store
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'menus_store_id_fkey'
  ) THEN
    ALTER TABLE "menus"
      ADD CONSTRAINT "menus_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3.9 menu_sections
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "menu_sections" (
  "id"         SERIAL PRIMARY KEY,
  "menu_id"    INTEGER NOT NULL,
  "store_id"   INTEGER NOT NULL,
  "name"       VARCHAR(100) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(6) DEFAULT now(),
  "updated_at" TIMESTAMP(6) DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "menu_sections_menu_name_key"
  ON "menu_sections" ("menu_id", "name");

CREATE INDEX IF NOT EXISTS "menu_sections_store_idx"
  ON "menu_sections" ("store_id");

CREATE INDEX IF NOT EXISTS "menu_sections_menu_sort_idx"
  ON "menu_sections" ("menu_id", "sort_order");

-- FK: menu (CASCADE — sections are children of the menu header)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'menu_sections_menu_id_fkey'
  ) THEN
    ALTER TABLE "menu_sections"
      ADD CONSTRAINT "menu_sections_menu_id_fkey"
      FOREIGN KEY ("menu_id") REFERENCES "menus"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- FK: store (denormalized for fast store-scoped section lookups)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'menu_sections_store_id_fkey'
  ) THEN
    ALTER TABLE "menu_sections"
      ADD CONSTRAINT "menu_sections_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3.10 menu_section_items
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "menu_section_items" (
  "id"                SERIAL PRIMARY KEY,
  "menu_section_id"   INTEGER NOT NULL,
  "product_id"        INTEGER NOT NULL,
  "sort_order"        INTEGER NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMP(6) DEFAULT now(),
  "updated_at"        TIMESTAMP(6) DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "menu_section_items_section_product_key"
  ON "menu_section_items" ("menu_section_id", "product_id");

CREATE INDEX IF NOT EXISTS "menu_section_items_product_idx"
  ON "menu_section_items" ("product_id");

CREATE INDEX IF NOT EXISTS "menu_section_items_section_sort_idx"
  ON "menu_section_items" ("menu_section_id", "sort_order");

-- FK: menu_section (CASCADE)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'menu_section_items_menu_section_id_fkey'
  ) THEN
    ALTER TABLE "menu_section_items"
      ADD CONSTRAINT "menu_section_items_menu_section_id_fkey"
      FOREIGN KEY ("menu_section_id") REFERENCES "menu_sections"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- FK: product
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'menu_section_items_product_id_fkey'
  ) THEN
    ALTER TABLE "menu_section_items"
      ADD CONSTRAINT "menu_section_items_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3.11 menu_availability_windows
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "menu_availability_windows" (
  "id"              SERIAL PRIMARY KEY,
  "store_id"        INTEGER NOT NULL,
  "menu_id"         INTEGER,
  "menu_section_id" INTEGER,
  "day_of_week"     INTEGER NOT NULL,
  "start_time"      VARCHAR(8) NOT NULL,
  "end_time"        VARCHAR(8) NOT NULL,
  "created_at"      TIMESTAMP(6) DEFAULT now(),
  "updated_at"      TIMESTAMP(6) DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "menu_availability_windows_store_dow_idx"
  ON "menu_availability_windows" ("store_id", "day_of_week");

CREATE INDEX IF NOT EXISTS "menu_availability_windows_menu_idx"
  ON "menu_availability_windows" ("menu_id");

CREATE INDEX IF NOT EXISTS "menu_availability_windows_section_idx"
  ON "menu_availability_windows" ("menu_section_id");

-- FK: store
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'menu_availability_windows_store_id_fkey'
  ) THEN
    ALTER TABLE "menu_availability_windows"
      ADD CONSTRAINT "menu_availability_windows_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- FK: menu (nullable, CASCADE)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'menu_availability_windows_menu_id_fkey'
  ) THEN
    ALTER TABLE "menu_availability_windows"
      ADD CONSTRAINT "menu_availability_windows_menu_id_fkey"
      FOREIGN KEY ("menu_id") REFERENCES "menus"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- FK: menu_section (nullable, CASCADE)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'menu_availability_windows_menu_section_id_fkey'
  ) THEN
    ALTER TABLE "menu_availability_windows"
      ADD CONSTRAINT "menu_availability_windows_menu_section_id_fkey"
      FOREIGN KEY ("menu_section_id") REFERENCES "menu_sections"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
