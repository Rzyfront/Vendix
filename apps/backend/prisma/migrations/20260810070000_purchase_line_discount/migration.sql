-- DATA IMPACT:
-- Tables affected:
--   purchase_order_items  (ADD COLUMN discount_percentage, discount_amount)
-- Expected row changes: NINGUNA fila se muta. Ambas columnas son nullable con
--   DEFAULT 0, asi que toda linea existente queda en descuento cero, que es
--   exactamente el comportamiento actual (hoy no existe descuento por linea).
-- Destructive operations: none. Sin DELETE, UPDATE, TRUNCATE, DROP ni CASCADE.
-- FK/cascade risk: none. No se agrega, elimina ni reapunta ninguna FK.
-- Idempotency: ADD COLUMN IF NOT EXISTS en ambas sentencias.
-- Approval: QUI-661. El usuario aprobo el alcance y las tres decisiones de
--   negocio (base gravable prorrateada, porcentaje+monto, historicos sin
--   recalcular) antes de crear el ticket.
--
-- ============================================================================
-- POR QUE
-- ============================================================================
-- El descuento que da un proveedor no tenia donde vivir a nivel de linea.
-- `purchase_orders.discount_amount` existia en la cabecera y hasta el OCR de
-- facturas lo venia inyectando, pero se restaba DESPUES del IVA y ni la
-- contabilidad ni el costeo lo leian: `receive()` valoriza las capas FIFO con
-- `unit_cost` linea a linea. El resultado era que la CxP se armaba sobre el
-- total rebajado mientras el inventario se capitalizaba al precio lleno.
--
-- Un descuento que se queda en la cabecera NO PUEDE llegar a la capa de costo
-- del producto, porque las capas se escriben por linea. Por eso el descuento
-- general se prorratea hacia estas columnas al escribir, y estas columnas son
-- las que alimentan `deriveLineTax`, que baja `unit_price_net` ANTES de derivar
-- el IVA. Asi el descuento comercial reduce, en este orden: la base gravable,
-- el IVA descontable y el costo capitalizado.
--
-- `discount_amount` es la fuente de verdad del calculo. `discount_percentage`
-- se guarda solo para poder reproducir como se llego al monto (el usuario
-- escribe uno y el otro se deriva), nunca para recalcular en lectura: un
-- porcentaje re-aplicado sobre un precio que cambio daria otro numero.
--
-- Las ordenes historicas NO se recalculan. Decision del usuario: reprorratear
-- descuentos viejos alteraria costos ya consumidos en ventas cerradas y
-- periodos de IVA ya declarados.
-- ============================================================================

ALTER TABLE "purchase_order_items"
  ADD COLUMN IF NOT EXISTS "discount_percentage" DECIMAL(5,2) DEFAULT 0;

ALTER TABLE "purchase_order_items"
  ADD COLUMN IF NOT EXISTS "discount_amount" DECIMAL(12,2) DEFAULT 0;
