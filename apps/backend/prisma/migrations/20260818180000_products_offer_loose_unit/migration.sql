-- La unidad suelta como opción publicable de la vitrina.
--
-- DATA IMPACT:
--   Tablas: products (ALTER TABLE ADD COLUMN)
--   Filas insertadas/actualizadas/borradas: 0 / 0 / 0
--   Destructivo: NO. Columna aditiva con DEFAULT true, así que toda fila
--   existente conserva el comportamiento que el comercio ya espera: la unidad
--   suelta se ofrece salvo que la apaguen a mano.
--   Idempotente: sí (IF NOT EXISTS).
--
-- Con `false`, la tienda en línea deja de ofrecer la línea sin `price_tier_id`
-- y la presentación por defecto pasa a regir el precio publicado.
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "offer_loose_unit" BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN "products"."offer_loose_unit" IS
  'Si la vitrina pública ofrece también la unidad suelta (línea sin price_tier_id) además de las presentaciones de venta del producto.';
