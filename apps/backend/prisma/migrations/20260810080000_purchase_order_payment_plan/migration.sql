-- DATA IMPACT:
-- Tables affected:
--   purchase_order_payment_schedules  (CREATE TABLE, sin filas)
--   purchase_orders                   (ADD COLUMN payment_plan, down_payment_amount)
-- Expected row changes: NINGUNA fila se muta. La tabla nace vacia y las dos
--   columnas son nullable: toda orden existente queda con payment_plan NULL,
--   que el codigo trata como el comportamiento actual (`ackPay` binario).
-- Destructive operations: none. Sin DELETE, UPDATE, TRUNCATE, DROP ni CASCADE
--   sobre tablas de negocio.
-- FK/cascade risk: la tabla nueva usa ON DELETE CASCADE hacia purchase_orders,
--   su PADRE. Es correcto y no es el caso que las reglas prohiben: una cuota
--   planeada no tiene vida propia — es un atributo de la orden, y si la orden
--   desaparece la cuota no significa nada. No se agrega ningun cascade
--   ENTRANTE nuevo sobre purchase_orders.
-- Idempotency: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, indice
--   IF NOT EXISTS y FK guardada por pg_constraint.
-- Approval: QUI-647.
--
-- ============================================================================
-- POR QUE
-- ============================================================================
-- El motor de cuotas ya existe (`ap_payment_schedules` + ApSchedulingService),
-- pero cuelga de `accounts_payable`, y la CxP NO existe cuando se crea la orden:
-- nace atada a la RECEPCION via `ap_reception_links`. Verificado en
-- `accounts-payable.service.ts:478-500`.
--
-- Por eso el plan de pago acordado con el proveedor al crear la orden necesita
-- donde vivir hasta que haya CxP a la cual colgarlo. Esta tabla es ese puente:
-- guarda las cuotas PLANEADAS contra la orden, y al materializarse la CxP se
-- copian a `ap_payment_schedules`, que sigue siendo el unico motor de cobro.
--
-- La alternativa era crear la CxP al aprobar la orden. Se descarto: cambiaria
-- el momento del reconocimiento contable del pasivo, que hoy ocurre con la
-- recepcion, y eso es una decision contable que este ticket no puede tomar.
-- ============================================================================

ALTER TABLE "purchase_orders"
  ADD COLUMN IF NOT EXISTS "payment_plan" VARCHAR(20);

ALTER TABLE "purchase_orders"
  ADD COLUMN IF NOT EXISTS "down_payment_amount" DECIMAL(12,2) DEFAULT 0;

CREATE TABLE IF NOT EXISTS "purchase_order_payment_schedules" (
  "id"                SERIAL PRIMARY KEY,
  "purchase_order_id" INTEGER NOT NULL,
  "scheduled_date"    DATE NOT NULL,
  "amount"            DECIMAL(12,2) NOT NULL,
  "status"            VARCHAR(20) NOT NULL DEFAULT 'planned',
  "materialized_at"   TIMESTAMP(6),
  "created_at"        TIMESTAMP(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "purchase_order_payment_schedules_order_idx"
  ON "purchase_order_payment_schedules" ("purchase_order_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_order_payment_schedules_order_fkey'
  ) THEN
    ALTER TABLE "purchase_order_payment_schedules"
      ADD CONSTRAINT "purchase_order_payment_schedules_order_fkey"
      FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
