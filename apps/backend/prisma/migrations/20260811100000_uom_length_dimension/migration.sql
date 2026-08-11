-- DATA IMPACT:
-- Tables affected: ninguna (solo el tipo enum uom_dimension_enum)
-- Expected row changes: 0
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: ADD VALUE IF NOT EXISTS
-- Approval: QUI-648 fase 2, paso 2 — plan aprobado en chat
--
-- La dimensión de longitud es la precondición para vender por metro (cable,
-- manguera, tubo). Viaja SOLA en su propia migración porque Postgres no permite
-- usar un valor de enum recién agregado dentro de la misma transacción que lo
-- crea: el seed que lo usa vive en la migración siguiente.

ALTER TYPE "uom_dimension_enum" ADD VALUE IF NOT EXISTS 'length';
