-- DATA IMPACT:
-- Tables affected:
--   products → +1 columna (`owner_commission_pct`) DEFAULT NULL. Backfill: 0 rows
--     (todos los servicios existentes quedan con split deshabilitado hasta que
--     el dueño configure el % por servicio; sin cambios de comportamiento).
--   booking_commission_accruals → tabla nueva. Inserciones arrancan en 0; sin
--     impacto en queries existentes (no se reemplaza ninguna tabla previa).
--   +1 enum `commission_accrual_status_enum` (accedido solo por la tabla nueva).
-- Expected row changes: 0 filas existentes modificadas.
-- Destructive operations: none — sin DROP, sin CASCADE, sin DELETE.
-- FK/cascade risk: la FK a bookings usa ON DELETE CASCADE porque la relación
--   es 1:1 lógica (1 accrual por reserva); si se borra una reserva, su accrual
--   también debe desaparecer. Las FKs a service_providers y products usan
--   comportamiento por defecto (RESTRICT en Prisma por convención del repo).
-- Idempotency: ADD COLUMN IF NOT EXISTS, CREATE TYPE sin IF NOT EXISTS
--   (Postgres no lo soporta, pero la migration corre una sola vez).
-- Approval: plan en /home/dmin/.claude/plans/lo-primero-esto-aqui-reactive-orbit.md.

-- ---------------------------------------------------------------------
-- 1) Porcentaje de comisión del dueño en products
--    NULL = no aplica split. Solo significativo cuando requires_booking=true.
--    El snapshot en booking_commission_accruals.owner_pct_snapshot congela
--    el valor al momento del cálculo.
-- ---------------------------------------------------------------------
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "owner_commission_pct" DECIMAL(5, 2);

-- ---------------------------------------------------------------------
-- 2) Enum de estado del accrual
-- ---------------------------------------------------------------------
CREATE TYPE "commission_accrual_status_enum" AS ENUM ('accrued', 'reversed');

-- ---------------------------------------------------------------------
-- 3) Tabla booking_commission_accruals
--    Una fila por reserva (UNIQUE booking_id) — idempotente. Se crea cuando
--    se recibe el pago de la orden ligada a la reserva, y se reversa cuando
--    la reserva pasa a `cancelled` o `no_show`. Ver plan para detalles.
-- ---------------------------------------------------------------------
CREATE TABLE "booking_commission_accruals" (
    "id"                  SERIAL PRIMARY KEY,
    "store_id"            INTEGER        NOT NULL,
    "organization_id"     INTEGER        NOT NULL,
    "booking_id"          INTEGER        NOT NULL,
    "order_id"            INTEGER,
    "payment_id"          INTEGER,
    "provider_id"         INTEGER,
    "employee_id"         INTEGER,
    "product_id"          INTEGER        NOT NULL,
    "base_amount"         DECIMAL(14, 2) NOT NULL,
    "owner_pct_snapshot"  DECIMAL(5, 2)  NOT NULL,
    "owner_amount"        DECIMAL(14, 2) NOT NULL,
    "provider_amount"     DECIMAL(14, 2) NOT NULL,
    "currency"            VARCHAR(10)    NOT NULL DEFAULT 'COP',
    "status"              "commission_accrual_status_enum" NOT NULL DEFAULT 'accrued',
    "reversed_reason"     VARCHAR(100),
    "reversed_at"         TIMESTAMP(6),
    "created_at"          TIMESTAMP(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_commission_accruals_booking_id_key" UNIQUE ("booking_id"),
    CONSTRAINT "booking_commission_accruals_booking_id_fkey"
      FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "booking_commission_accruals_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "booking_commission_accruals_provider_id_fkey"
      FOREIGN KEY ("provider_id") REFERENCES "service_providers"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "booking_commission_accruals_store_id_created_at_idx"
  ON "booking_commission_accruals" ("store_id", "created_at");
CREATE INDEX IF NOT EXISTS "booking_commission_accruals_provider_id_created_at_idx"
  ON "booking_commission_accruals" ("provider_id", "created_at");
CREATE INDEX IF NOT EXISTS "booking_commission_accruals_employee_id_created_at_idx"
  ON "booking_commission_accruals" ("employee_id", "created_at");
CREATE INDEX IF NOT EXISTS "booking_commission_accruals_product_id_created_at_idx"
  ON "booking_commission_accruals" ("product_id", "created_at");
CREATE INDEX IF NOT EXISTS "booking_commission_accruals_status_idx"
  ON "booking_commission_accruals" ("status");
CREATE INDEX IF NOT EXISTS "booking_commission_accruals_store_id_status_created_at_idx"
  ON "booking_commission_accruals" ("store_id", "status", "created_at");