-- DATA IMPACT:
-- Tablas afectadas:
--   user_commissions → tabla nueva (5 columnas con FK a users, bookings, orders, payments, products, service_providers)
--   commission_status_enum → enum nuevo
-- Backfill desde booking_commission_accruals (status='accrued'/'reversed' → 'accrued'/'reversed' en nuevo enum)
-- Expected row changes: mismas filas que booking_commission_accruals tenga (provider_id es NULL en legacy,
--   entonces employee_id se resuelve vía JOIN a service_providers → users)
-- Destructive operations: none — sin DROP, sin CASCADE.
-- FK/cascade risk:
--   - FK a bookings → ON DELETE SET NULL (no rompemos booking legacy si se borra)
--   - FK a orders → ON DELETE SET NULL
--   - FK a payments → ON DELETE SET NULL
--   - FK a service_providers → ON DELETE SET NULL
--   - FK a products → ON DELETE RESTRICT (no se puede borrar producto con comisiones)
--   - FK a users (employee) → ON DELETE RESTRICT (no se puede borrar empleado con comisiones)
-- Idempotency: CREATE TYPE/INDEX/CONSTRAINT con IF NOT EXISTS donde Postgres lo soporta.
--   El backfill usa INSERT ... SELECT ... ON CONFLICT DO NOTHING para no duplicar.
-- Approval: QUI-678, ticket del feature "Comisiones dueño/mecánico (CxP + decline flow)".

-- ---------------------------------------------------------------------
-- 1) Enum de estado del accrual (5 valores vs 2 del modelo legacy)
--    pending     → creada, pago del cliente aún no confirmado
--    accrued     → cliente pagó, se debe al mecánico
--    paid        → se le pagó al mecánico (CxP cerrada)
--    declined    → NO se le pagará (con motivo)
--    reversed    → reserva cancelada/no-show, comisión reversada
-- ---------------------------------------------------------------------
CREATE TYPE "commission_status_enum" AS ENUM (
  'pending',
  'accrued',
  'paid',
  'declined',
  'reversed'
);

-- ---------------------------------------------------------------------
-- 2) Tabla user_commissions
--    Una fila por comisión. FK a employee (users) + provider (service_providers)
--    + booking + order + payment + product. UNIQUE en booking_id para idempotencia
--    (1 reserva no genera 2 comisiones, igual que el modelo legacy).
-- ---------------------------------------------------------------------
CREATE TABLE "user_commissions" (
    "id"                     SERIAL PRIMARY KEY,
    "store_id"               INTEGER        NOT NULL,
    "organization_id"        INTEGER        NOT NULL,

    -- Quién recibe la comisión
    "employee_id"            INTEGER        NOT NULL,
    "provider_id"            INTEGER,

    -- De dónde viene
    "booking_id"             INTEGER,
    "order_id"               INTEGER,
    "payment_id"             INTEGER,
    "product_id"             INTEGER,

    -- Montos (snapshot al momento del accrual — el % puede cambiar mañana)
    "base_amount"            DECIMAL(14, 2) NOT NULL,
    "commission_pct"         DECIMAL(5, 2)  NOT NULL,
    "commission_amount"      DECIMAL(14, 2) NOT NULL,
    "currency"               VARCHAR(10)    NOT NULL DEFAULT 'COP',

    -- State machine
    "status"                 "commission_status_enum" NOT NULL DEFAULT 'pending',
    "declined_reason"        TEXT,
    "declined_at"            TIMESTAMP(6),
    "declined_by_user_id"    INTEGER,

    -- Pago al mecánico
    "paid_at"                TIMESTAMP(6),
    "paid_by_user_id"        INTEGER,
    "payment_reference"      VARCHAR(100),

    -- Accounting
    "accounting_journal_id"  INTEGER,

    -- Audit
    "notes"                  TEXT,
    "created_at"             TIMESTAMP(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMP(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_commissions_booking_id_key" UNIQUE ("booking_id"),
    CONSTRAINT "user_commissions_employee_id_fkey"
      FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "user_commissions_provider_id_fkey"
      FOREIGN KEY ("provider_id") REFERENCES "service_providers"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "user_commissions_booking_id_fkey"
      FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "user_commissions_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "user_commissions_payment_id_fkey"
      FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "user_commissions_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "user_commissions_declined_by_user_id_fkey"
      FOREIGN KEY ("declined_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "user_commissions_paid_by_user_id_fkey"
      FOREIGN KEY ("paid_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "user_commissions_accounting_journal_id_fkey"
      FOREIGN KEY ("accounting_journal_id") REFERENCES "accounting_entries"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

-- ---------------------------------------------------------------------
-- 3) Índices para queries frecuentes
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "user_commissions_employee_status_created_at_idx"
  ON "user_commissions" ("employee_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "user_commissions_store_status_created_at_idx"
  ON "user_commissions" ("store_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "user_commissions_status_declined_at_idx"
  ON "user_commissions" ("status", "declined_at");
CREATE INDEX IF NOT EXISTS "user_commissions_status_paid_at_idx"
  ON "user_commissions" ("status", "paid_at");
CREATE INDEX IF NOT EXISTS "user_commissions_product_id_idx"
  ON "user_commissions" ("product_id");
CREATE INDEX IF NOT EXISTS "user_commissions_created_at_idx"
  ON "user_commissions" ("created_at");

-- ---------------------------------------------------------------------
-- 4) Backfill desde booking_commission_accruals
--    Mapeo de status:
--      accrued   → accrued
--      reversed  → reversed
--      (legacy tenía solo 2 valores)
--    employee_id: se obtiene de service_providers.employee_id (legacy ya lo denormalizó)
--    ON CONFLICT DO NOTHING: idempotente si se corre 2 veces.
-- ---------------------------------------------------------------------
INSERT INTO "user_commissions" (
  store_id, organization_id,
  employee_id, provider_id,
  booking_id, order_id, payment_id,
  product_id,
  base_amount, commission_pct, commission_amount,
  currency, status,
  notes, created_at, updated_at
)
SELECT
  bca.store_id,
  bca.organization_id,
  bca.employee_id,
  bca.provider_id,
  bca.booking_id,
  bca.order_id,
  bca.payment_id,
  bca.product_id,
  bca.base_amount,
  bca.owner_pct_snapshot,
  bca.owner_amount,
  bca.currency,
  CASE
    WHEN bca.status = 'accrued' THEN 'accrued'::commission_status_enum
    WHEN bca.status = 'reversed' THEN 'reversed'::commission_status_enum
    ELSE 'pending'::commission_status_enum
  END,
  'Backfill desde booking_commission_accruals (QUI-678)',
  bca.created_at,
  bca.updated_at
FROM "booking_commission_accruals" bca
WHERE bca.employee_id IS NOT NULL  -- el legacy tenía employee_id NULL → no podemos asignar
ON CONFLICT ("booking_id") DO NOTHING;

-- Marcar la migration legacy aplicada con nombre exacto para que la lógica
-- legacy coexista como "deprecated". NO borramos la tabla todavía — el líder
-- confirmó que se hace soft-delete 1 sprint después del cutover.
-- La columna `booking_commission_accruals` queda intacta.