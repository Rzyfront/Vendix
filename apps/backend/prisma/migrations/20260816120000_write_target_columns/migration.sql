-- DATA IMPACT:
-- Tables affected: return_orders, refunds
-- Expected row changes: 0 — solo se agregan columnas nullable, ninguna fila se lee ni se escribe
-- Destructive operations: none (sin DROP, sin CASCADE, sin DELETE/UPDATE)
-- FK/cascade risk: none (no se tocan constraints)
-- Idempotency: ADD COLUMN IF NOT EXISTS
-- Approval: correccion de defecto — el codigo ya escribia estas tres columnas
--
-- Contexto: `return-orders.service.ts` y `payment-gateway.service.ts` escribian
-- `processed_date`, `cancelled_date` y `gateway_response` contra tablas que no
-- las tenian. Prisma rechazaba el `data` completo con
-- `PrismaClientValidationError`, que el filtro de excepciones degrada a
-- `SYS_INTERNAL_001`: procesar una devolucion, anularla, o registrar un
-- reembolso ya cobrado en la pasarela devolvian «Error interno del servidor».
-- Se agregan las columnas en vez de borrar las escrituras porque las tres son
-- marcas de auditoria que el flujo necesita.

ALTER TABLE "return_orders" ADD COLUMN IF NOT EXISTS "processed_date" TIMESTAMP(6);
ALTER TABLE "return_orders" ADD COLUMN IF NOT EXISTS "cancelled_date" TIMESTAMP(6);

-- Misma forma que `payments.gateway_response`.
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "gateway_response" JSONB;
