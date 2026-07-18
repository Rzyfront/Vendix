-- DATA IMPACT: dispatch_notes.customer_address
-- Agrega latitude/longitude vía merge jsonb aditivo (||), idempotente
-- (guard NOT ? 'latitude'), sin CASCADE/DROP/DELETE/UPDATE sin WHERE.
--
-- Escenarios:
-- 1. dispatch_notes con order_id vinculado a una address con coords
-- 2. dispatch_notes con sales_order_id vinculado a una address con coords
--
-- Sin datos: no hace nada (guard WHERE ... AND ... AND ...).

UPDATE dispatch_notes dn
SET customer_address = dn.customer_address || jsonb_strip_nulls(jsonb_build_object(
      'latitude', src.latitude, 'longitude', src.longitude))
FROM (
  SELECT dn2.id,
         COALESCE(oa.latitude, sa.latitude)   AS latitude,
         COALESCE(oa.longitude, sa.longitude) AS longitude
  FROM dispatch_notes dn2
  LEFT JOIN orders       o  ON o.id  = dn2.order_id
  LEFT JOIN addresses    oa ON oa.id = o.shipping_address_id
  LEFT JOIN sales_orders so ON so.id = dn2.sales_order_id
  LEFT JOIN addresses    sa ON sa.id = so.shipping_address_id
) src
WHERE dn.id = src.id
  AND dn.customer_address ? 'address_line1'
  AND NOT (dn.customer_address ? 'latitude')
  AND src.latitude IS NOT NULL AND src.longitude IS NOT NULL;
