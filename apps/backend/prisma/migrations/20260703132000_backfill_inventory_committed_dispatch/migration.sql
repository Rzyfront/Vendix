-- DATA IMPACT:
--   Tabla afectada: order_items (solo columna inventory_committed; sin cambios de schema).
--   Backfill correctivo del flag de idempotencia anti-doble-descuento.
--
--   El backfill original (20260703120000) marcó committed las líneas con una
--   transaccion type='sale'. Pero las deducciones de ENTREGA POR REMISION usan
--   updateStock(movement_type='stock_out'), que mapMovementToTransactionType
--   registra como inventory_transactions.type='stock_in' con quantity_change < 0
--   (el signo decide la direccion real, no el label del type). Esas lineas
--   quedaron con inventory_committed=false y se re-deducirian si la orden pasa
--   luego a 'finished'.
--
--   Regla robusta: cualquier transaccion con quantity_change < 0 ligada a un
--   order_item significa que esa linea YA descontó stock -> committed=true.
--   Idempotente (WHERE inventory_committed=false), aditiva, con WHERE (no masivo),
--   sin CASCADE/DROP/DELETE.

UPDATE "order_items" oi
   SET "inventory_committed" = true
 WHERE oi."inventory_committed" = false
   AND EXISTS (
         SELECT 1
           FROM "inventory_transactions" it
          WHERE it."order_item_id" = oi."id"
            AND it."quantity_change" < 0
       );
