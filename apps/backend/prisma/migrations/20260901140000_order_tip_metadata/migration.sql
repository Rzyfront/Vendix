-- carril D (lina) — D3 / QUI: metadatos de propina en la orden.
-- `orders.tip_amount` YA EXISTE (schema.prisma:1483, Decimal(12,2),
-- nullable, persistido por GAP-6 al cobrar). Esta migracion añade
-- SOLO los metadatos de cómo se calculó y a quién se atribuye.
--
-- La propina en Colombia es VOLUNTARIA, NO causa IVA y NO entra en
-- la base gravable (tax-typing skill, regla explícita para propinas).
-- El accounting ya la reconoce como pasivo custodio (CR propinas por
-- pagar) en payments.service.ts:1438 — el asiento la separa del
-- ingreso por venta.
--
-- Diseño de columnas (todo aditivo nullable, sin enum, sin default):
--  - tip_type: 'percentage' si se calculó como % del subtotal,
--              'fixed' si fue un monto libre. Documenta el modo.
--  - tip_value: si tip_type='percentage', el % aplicado (0–100);
--               si tip_type='fixed', el monto libre que el operador
--               tipeó (entonces coincide con tip_amount).
--               DECIMAL(14,2) para que tanto el 999.99 % como el
--               monto fijo de 10.000 COP quepan sin numeric overflow.
--  - tip_waiter_id: FK users.id del mesero que recibe la propina
--                   (atribución para informes, no reparto ni
--                   liquidación en esta iteración).
--
-- DATA IMPACT:
--   Tables affected: orders
--   Expected row changes: 0
--   Filas existentes quedan con las tres columnas en NULL
--   (no son propinas), sin backfill.

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tip_type" VARCHAR(12);

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tip_value" DECIMAL(14,2);

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tip_waiter_id" INT
  REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "orders_tip_waiter_id_idx"
  ON "orders"("tip_waiter_id");

-- Endurecida por la orquestacion antes de aplicar: nombre del indice
-- alineado con el que Prisma deriva de `@@index([tip_waiter_id])` en
-- schema.prisma para evitar drift en el proximo `prisma migrate dev`.
