-- DATA IMPACT:
-- Tables affected: order_items (ADD COLUMN inventory_committed, inventory_committed_at).
-- Enum changes: none.
-- Expected row changes: backfill sets inventory_committed = true ONLY for order_items
--   whose stock ya fue descontado — es decir, items marcados en fire
--   (inventory_consumed_at_fire = true) o con una transaccion de venta existente
--   (inventory_transactions.type = 'sale'). Evita re-deducir historicos cuando el
--   servicio unificado de commit entre en operacion. Backfill SIEMPRE con WHERE.
-- NOTE: el enum inventory_transaction_type_enum NO tiene 'stock_out'; sus valores
--   reales son (stock_in, sale, return, adjustment_damage, initial). La salida de
--   stock por venta se registra como 'sale', que es el unico literal usado aqui.
-- Destructive operations: none (aditivo; sin DROP/TRUNCATE/DELETE, sin CASCADE).
-- FK/cascade risk: none (no toca constraints).
-- Idempotency: ADD COLUMN IF NOT EXISTS + backfill idempotente (marcar true dos
--   veces no cambia el resultado). Seguro re-ejecutar.
-- Approval: plan aprobado (Seccion 2 "Idempotencia", Ola 0 Paso 1).

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "inventory_committed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "inventory_committed_at" TIMESTAMP(6);

UPDATE "order_items" oi
   SET "inventory_committed" = true
 WHERE oi."inventory_consumed_at_fire" = true
    OR EXISTS (
         SELECT 1
           FROM "inventory_transactions" it
          WHERE it."order_item_id" = oi."id"
            AND it."type" = 'sale'
       );
