-- DATA IMPACT:
-- Tables affected: order_items (ADD COLUMN x2 + UPDATE de backfill)
-- Expected row changes: se actualizan SOLO los order_items que ya tienen un
--   kitchen_ticket_item en estado 'delivered'. Los demas quedan con
--   delivered_at NULL, que significa "no entregado todavia" — el estado
--   correcto para ellos.
-- Destructive operations: none. Sin DELETE, TRUNCATE, DROP ni CASCADE. El
--   UPDATE lleva WHERE y solo escribe donde la columna esta NULL.
-- FK/cascade risk: delivered_by_user_id -> users(id) ON DELETE SET NULL, para
--   que borrar un usuario no arrastre la linea de pedido ni bloquee su borrado.
--   Perder QUIEN entrego es aceptable; perder la venta no.
-- Idempotency: ADD COLUMN IF NOT EXISTS + el UPDATE guardado por
--   `delivered_at IS NULL`, asi que una segunda corrida no reescribe nada.
-- Approval: QUI-652.
--
-- POR QUE
-- =======
-- El ciclo de entrega estaba ACOPLADO AL TICKET DE COCINA. El estado vivia solo
-- en `kitchen_ticket_items.status` ('delivered') y `order_items` no tenia NINGUN
-- campo de entrega. Al mismo tiempo, el fire excluye explicitamente todo lo que
-- no sea `product_type='prepared'` (kitchen-fire.service.ts).
--
-- Resultado: un producto no preparado — una cerveza en botella, un agua, algo de
-- la nevera — NUNCA obtenia fila en kitchen_ticket_items, el frontend
-- (`kitchenStatusFor()`) devolvia null para siempre, y el boton "Marcar
-- entregado" no se renderizaba porque exige estado 'ready'. El item se quedaba
-- permanentemente en "Sin enviar" y no habia forma de registrar que se le
-- entrego al cliente: se perdia la trazabilidad de que pidio y que falta.
--
-- La entrega es un hecho de SERVICIO (lo recibio el cliente?), no de COCINA (se
-- cocino?). Una cerveza necesita trazabilidad de entrega y nunca necesita
-- cocinarse. Y con QUI-653, un plato para llevar tambien se entrega, empacado.
-- Por eso el hecho se mueve a `order_items`, independiente del ticket.
--
-- Lo que NO cambia: para platos preparados el flujo de cocina sigue exigiendo
-- 'ready' antes de permitir marcar entregado. `kitchenStatusFor()` deja de ser
-- la fuente del estado de entrega y pasa a informar solo el estado de cocina; la
-- UI muestra dos dimensiones separadas.

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMP(6);
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "delivered_by_user_id" INTEGER;

CREATE INDEX IF NOT EXISTS "order_items_delivered_by_user_id_idx"
  ON "order_items"("delivered_by_user_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_delivered_by_user_id_fkey') THEN
    ALTER TABLE "order_items" ADD CONSTRAINT "order_items_delivered_by_user_id_fkey"
      FOREIGN KEY ("delivered_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- Backfill: los items ya marcados 'delivered' via ticket de cocina conservan su
-- marca. `updated_at` del kitchen_ticket_item es lo mas cercano al instante de
-- entrega que existe en los datos historicos — no hay columna `delivered_at` en
-- el ticket. Se documenta como aproximacion en vez de inventar NOW(), que
-- fecharia toda la historia el dia del deploy.
--
-- El QUIEN no se puede recuperar: kitchen_ticket_items no registra quien cambio
-- el estado. Queda NULL, que es honesto — "entregado, autor desconocido" — y
-- distinto de "no entregado" (delivered_at NULL).
UPDATE "order_items" oi
SET "delivered_at" = kti."updated_at"
FROM "kitchen_ticket_items" kti
WHERE kti."order_item_id" = oi."id"
  AND kti."status" = 'delivered'
  AND oi."delivered_at" IS NULL;
