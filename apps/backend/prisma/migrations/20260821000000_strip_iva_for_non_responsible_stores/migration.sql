-- =====================================================
-- Desasignación de IVA para tiendas no responsables (F4).
-- Trigger: flip del default isVatResponsible a false
--          (commit 40df1ef, 2026-08-21) +
--          decisión del usuario sobre catálogo completo.
-- =====================================================
-- DATA IMPACT:
-- - Tablas afectadas:
--     * products (UPDATE base_price) — depende del inventario
--     * product_tax_assignments (DELETE) — depende del inventario
-- - Filas esperadas: ejecutar las queries de verificación en prod-clone
--   antes de correr la migración. Reportar conteos al orquestador.
-- - Filtros:
--     * Solo `tax_categories.tax_type = 'iva'`
--     * Solo tiendas donde NI store_settings NI organization_settings
--       fiscal_data.tax_responsibilities contienen 'O-48'
--     * (Criterio conservador: si ALGUNA capa tiene O-48, NO se toca.
--       Esto protege tenants que acaban de declarar O-48 sin que
--       la otra capa se haya sincronizado todavía.)
-- - Operaciones destructivas:
--     * DELETE FROM product_tax_assignments WHERE (product_id, tc_id) IN (snapshot)
--     * UPDATE products SET base_price = ROUND(base_price * (1 + total_iva_rate), 2)
--       WHERE id IN (snapshot)
--   No hay TRUNCATE / DROP / ALTER. No hay DELETE sin WHERE.
-- - FK/cascade risk: product_tax_assignments no tiene FKs entrantes.
--   products tiene muchas FKs salientes pero solo UPDATEamos columnas.
-- - Idempotencia: la pasada 1 toca N filas; la pasada 2 encuentra 0
--   filas con IVA en no-responsables (ya se borraron) y no hace nada.
--   Los TEMP TABLEs se recrean en cada pasada.
-- - Reversibilidad: NO_INLINE — la migración NO es reversible por sí sola.
--   Para revertir, restaurar el snapshot de DB tomado antes del deploy.
--   Este archivo NO incluye SQL inverso porque los TEMP TABLEs se borran
--   al COMMIT y no dejan rastro de los base_price antiguos.
-- - Approval: plan crítico docs/plans/purrfect-chasing-gizmo.md (Fase 3),
--   decisión del usuario 2026-08-21 ("Preservar el precio final subiendo
--   base_price" + "Todos los que no sean responsables").
-- =====================================================
-- POR QUE
-- =====================================================
-- El default pre-F4 (`isVatResponsible` retornaba true para indeterminado)
-- permitía que un tenant sin datos fiscales cargados cobrara IVA. Con el
-- flip a false, el backend bloquea con HTTP 412 cualquier intento de venta
-- o asignación de IVA en un tenant no responsable. Si la migración se
-- quedara sin correr, los merchants no podrían vender su catálogo con
-- asignaciones de IVA en tiendas no declaradas — el precio publicado
-- (final_price) se mantendría, pero la línea de impuesto quedaría
-- huérfana y el bloqueador de backend rompería el flujo.
--
-- La compensación de base_price preserva el final_price publicado (es
-- el mismo cálculo que calculateFinalPrice hace en cada lectura).
-- El cliente paga lo mismo; el comerciante no pierde ingreso; la línea
-- de IVA desaparece de la factura porque ya no hay tasa que aplicarle.
--
-- Algoritmo de compensación: replicamos EXACTAMENTE la fórmula de
-- calculateFinalPrice (products.service.ts:3853-3873), que suma las tasas
-- de cada tax_rate de cada tax_category asignada al producto. Si el
-- backend cambia a cálculo multiplicativo en el futuro, esta migración
-- debe actualizarse.
-- =====================================================

BEGIN;

-- 1. Snapshot: por producto, suma de tasas de IVA aplicables.
--    Filtra por tax_type='iva' y por no-responsable.
CREATE TEMP TABLE vat_migration_snapshot_2026_08_21 ON COMMIT DROP AS
SELECT
  p.id AS product_id,
  SUM(tr.rate) AS total_iva_rate
FROM products p
JOIN stores s ON s.id = p.store_id
JOIN store_settings ss ON ss.store_id = s.id
JOIN organization_settings os ON os.organization_id = s.organization_id
JOIN product_tax_assignments pta ON pta.product_id = p.id
JOIN tax_categories tc ON tc.id = pta.tax_category_id
JOIN tax_rates tr ON tr.tax_category_id = tc.id
WHERE tc.tax_type = 'iva'
  AND NOT (
    COALESCE(ss.settings->'fiscal_data'->'tax_responsibilities', '[]'::jsonb)
      @> '["O-48"]'::jsonb
    OR COALESCE(os.settings->'fiscal_data'->'tax_responsibilities', '[]'::jsonb)
      @> '["O-48"]'::jsonb
  )
GROUP BY p.id;

-- 2. Asignaciones a borrar (separado para no romper el GROUP BY del paso 1).
CREATE TEMP TABLE vat_migration_assignments_2026_08_21 ON COMMIT DROP AS
SELECT DISTINCT pta.product_id, pta.tax_category_id
FROM product_tax_assignments pta
JOIN tax_categories tc ON tc.id = pta.tax_category_id
JOIN products p ON p.id = pta.product_id
JOIN stores s ON s.id = p.store_id
JOIN store_settings ss ON ss.store_id = s.id
JOIN organization_settings os ON os.organization_id = s.organization_id
WHERE tc.tax_type = 'iva'
  AND NOT (
    COALESCE(ss.settings->'fiscal_data'->'tax_responsibilities', '[]'::jsonb)
      @> '["O-48"]'::jsonb
    OR COALESCE(os.settings->'fiscal_data'->'tax_responsibilities', '[]'::jsonb)
      @> '["O-48"]'::jsonb
  );

-- 3. Compensar base_price. ROUND a 2 decimales (mismo redondeo que
--    calculateFinalPrice — products.service.ts:3872).
UPDATE products p
SET base_price = ROUND(p.base_price * (1 + snap.total_iva_rate), 2)
FROM vat_migration_snapshot_2026_08_21 snap
WHERE p.id = snap.product_id;

-- 4. Borrar las asignaciones de IVA de los no-responsables.
DELETE FROM product_tax_assignments pta
USING vat_migration_assignments_2026_08_21 snap
WHERE pta.product_id = snap.product_id
  AND pta.tax_category_id = snap.tax_category_id;

COMMIT;

-- =====================================================
-- QUERIES DE VERIFICACIÓN (NO se ejecutan en la migración)
-- =====================================================
-- Contar productos afectados ANTES de la migración:
--   SELECT COUNT(*) FROM vat_migration_snapshot_2026_08_21;
--   SELECT COUNT(*) FROM vat_migration_assignments_2026_08_21;
-- Por organización (top 10):
--   SELECT s.organization_id, COUNT(*) AS productos
--   FROM vat_migration_snapshot_2026_08_21 snap
--   JOIN products p ON p.id = snap.product_id
--   JOIN stores s ON s.id = p.store_id
--   GROUP BY s.organization_id ORDER BY productos DESC LIMIT 10;
-- Verificar final_price invariante en una muestra:
--   SELECT p.id, p.base_price AS new_base, snap.total_iva_rate,
--          ROUND(p.base_price / (1 + snap.total_iva_rate), 2) AS old_base_equivalente
--   FROM vat_migration_snapshot_2026_08_21 snap
--   JOIN products p ON p.id = snap.product_id
--   LIMIT 50;
-- Comparar con un dump pre-migración para confirmar que old_base_equivalente
-- es razonable (debe coincidir con el base_price del dump).
