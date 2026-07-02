-- =====================================================
-- M4: backfill_store_municipality_from_addresses
-- =====================================================
-- DATA IMPACT: best-effort desde la dirección primaria de la tienda.
--              addresses ya tiene municipality_code propio (M3+existente) —
--              se copia a stores.municipality_code cuando la dirección es
--              la primaria y el store aún no tiene municipio asignado.
--              Mapeo a ica_municipal_rates: se busca por coincidencia directa;
--              si no, por los primeros 5 chars (Divipola 5 dígitos).
-- Idempotente: solo actualiza stores con municipality_code NULL.
-- =====================================================

UPDATE stores s
SET municipality_code = a.municipality_code
FROM addresses a
WHERE a.store_id = s.id
  AND a.is_primary = TRUE
  AND s.municipality_code IS NULL
  AND a.municipality_code IS NOT NULL;

-- Segundo intento: si la dirección no trae municipality_code pero el address_line
-- o city es identificable, intentar matchear contra ica_municipal_rates.
-- (No siempre es posible derivar municipio desde texto libre; se deja NULL
--  en esos casos y se documenta en la captura manual de identidad fiscal.)