-- DATA IMPACT:
-- Tables affected: table_sessions (solo esquema: 1 columna nula nueva — ninguna fila se modifica)
-- Expected row changes: NINGUNO. No hay UPDATE, INSERT ni DELETE en este archivo.
--   La columna nueva nace NULL ("sin notas") para toda sesión existente.
-- Destructive operations: none. Sin DROP, TRUNCATE ni CASCADE.
-- FK/cascade risk: none. No se crea ni se toca ninguna FK ni índice.
-- Idempotency: ADD COLUMN IF NOT EXISTS. Una segunda corrida no hace nada.
-- Atomicity: BEGIN/COMMIT EXPLÍCITOS (Prisma no envuelve el archivo en transacción).
-- Approval: QUI-898 — decisión de Rafael (tanda 2): notas informales en la sesión de mesa;
--   implementadas como una columna de texto libre, aditiva.
--
-- POR QUÉ EXISTE
-- El mesero anota texto libre en una mesa activa ("cliente pidió un vaso extra").
-- Vive en la sesión, la ve todo el staff, se conserva al cerrarla (historial) y NO
-- afecta orden, totales, inventario ni KDS.

BEGIN;

ALTER TABLE "table_sessions" ADD COLUMN IF NOT EXISTS "informal_notes" TEXT;

COMMIT;
