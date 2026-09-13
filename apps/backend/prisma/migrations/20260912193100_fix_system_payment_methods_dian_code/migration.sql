-- Sanea system_payment_methods.dian_code antes de cablearlo al XML de la DIAN.
--
-- La columna existe poblada desde `20260322080000_add_dian_payment_form`, pero
-- ningun archivo .ts la lee todavia, asi que sus valores nunca fueron
-- ejercitados contra la tabla real de medios de pago (`MediosPago-2.1.gc`).
-- Al revisarlos aparecen dos que la DIAN no aceptaria:
--
--   * `wallet` = '99'  -> '99' NO pertenece al conjunto de 75 codigos validos
--                         (el conjunto salta de '97' a 'ZZZ'). Ver
--                         DIAN_PAYMENT_MEANS_ALL en
--                         apps/backend/src/domains/store/invoicing/providers/
--                         dian-direct/constants/dian-document-types.ts
--                         Un codigo fuera del conjunto es rechazo seguro del
--                         documento electronico.
--
--   * `wompi`  = '48'  -> '48' es "Tarjeta credito". Wompi multiplexa
--                         tarjeta / PSE / Nequi / Bancolombia y el instrumento
--                         concreto NO se persiste, asi que declarar tarjeta
--                         afirmaria un hecho que puede ser falso. Se baja a
--                         '1' (Instrumento no definido), el mismo criterio ya
--                         documentado en subscription-invoice-fiscal.contract.ts
--
-- Los demas tipos se reafirman explicitamente para que la tabla quede
-- determinista sin importar si la fila la creo el seed o la migracion de marzo.
--
-- DATA IMPACT:
-- Tables affected: system_payment_methods (solo la columna dian_code)
-- Expected row changes: <= 8 filas (una por valor de payment_methods_type_enum).
--                       En la practica cambian 1-2 (wallet y/o wompi); el resto
--                       ya trae el valor objetivo y el WHERE las excluye.
-- Destructive operations: none. Sin DROP, DELETE, TRUNCATE, CASCADE ni ALTER TYPE.
--                         Ninguna columna pierde datos: dian_code pasa de un
--                         codigo invalido/impreciso a uno valido.
-- FK/cascade risk: none. system_payment_methods no participa en ninguna FK
--                  afectada por un UPDATE de una columna escalar no referenciada.
-- Idempotency: cada UPDATE lleva `IS DISTINCT FROM` (NULL-safe), asi que una
--              segunda corrida afecta 0 filas y produce el mismo estado final.
-- Approval: decision de negocio aprobada en chat.

-- '10' Efectivo
UPDATE "system_payment_methods"
SET "dian_code" = '10'
WHERE "type" = 'cash' AND "dian_code" IS DISTINCT FROM '10';

-- '10' Efectivo contra entrega (el cobro sigue siendo en efectivo)
UPDATE "system_payment_methods"
SET "dian_code" = '10'
WHERE "type" = 'cash_on_delivery' AND "dian_code" IS DISTINCT FROM '10';

-- '48' Tarjeta credito
UPDATE "system_payment_methods"
SET "dian_code" = '48'
WHERE "type" = 'card' AND "dian_code" IS DISTINCT FROM '48';

-- '47' Transferencia debito bancaria
UPDATE "system_payment_methods"
SET "dian_code" = '47'
WHERE "type" = 'bank_transfer' AND "dian_code" IS DISTINCT FROM '47';

-- '1' Instrumento no definido: Wompi multiplexa el instrumento real
UPDATE "system_payment_methods"
SET "dian_code" = '1'
WHERE "type" = 'wompi' AND "dian_code" IS DISTINCT FROM '1';

-- '1' Instrumento no definido: reemplaza el invalido '99'
UPDATE "system_payment_methods"
SET "dian_code" = '1'
WHERE "type" = 'wallet' AND "dian_code" IS DISTINCT FROM '1';

-- '1' Instrumento no definido
UPDATE "system_payment_methods"
SET "dian_code" = '1'
WHERE "type" = 'paypal' AND "dian_code" IS DISTINCT FROM '1';

-- '1' Instrumento no definido
UPDATE "system_payment_methods"
SET "dian_code" = '1'
WHERE "type" = 'voucher' AND "dian_code" IS DISTINCT FROM '1';
