-- DATA IMPACT:
-- Tables affected: audit_logs, products
-- Expected row changes: 0 (solo indices, ninguna fila mutada)
-- Destructive operations: ninguna
-- FK/cascade risk: ninguno
-- Idempotency: CREATE INDEX CONCURRENTLY IF NOT EXISTS — re-ejecutable sin error
-- Reversibility:
--   DROP INDEX CONCURRENTLY IF EXISTS "audit_logs_resource_resource_id_created_at_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "products_state_id_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "products_store_id_state_idx";
-- Approval: plan critico CP-PURCHASE-TRANSPARENCY, bloques C.10 y D.0.

-- ---------------------------------------------------------------------------
-- POR QUE ESTE ARCHIVO ESTA SEPARADO DE SU MIGRACION HERMANA
--
-- `audit_logs` y `products` son tablas grandes (audit_logs ya pasa de 30.000
-- filas en local), asi que sus indices se crean con CONCURRENTLY para no tomar
-- un ACCESS EXCLUSIVE lock sobre la tabla durante la construccion.
--
-- CREATE INDEX CONCURRENTLY no puede correr dentro de una transaccion. Varias
-- migraciones antiguas de este repositorio afirman en sus comentarios que por
-- eso "no se puede usar CONCURRENTLY con Prisma" — ESO ESTA DESACTUALIZADO. La
-- migracion 20260819000000_po_perf_indexes usa CREATE INDEX CONCURRENTLY, esta
-- marcada como aplicada en `_prisma_migrations` y sus dos indices
-- (po_supplier_date_idx, po_status_idx) existen en la base. El patron
-- establecido y PROBADO en este repositorio es: un archivo de migracion que
-- contiene UNICAMENTE sentencias CONCURRENTLY, cada una por separado, sin
-- mezclar DDL transaccional. Este archivo respeta ese patron al pie de la letra,
-- y por eso las columnas, la FK y el CHECK viven en la migracion hermana
-- 20260822180000_purchase_transparency_additive_schema.
--
-- Riesgo residual asumido: un CREATE INDEX CONCURRENTLY que falla deja un
-- indice INVALID en lugar de revertir. El `IF NOT EXISTS` NO lo repara (un
-- indice invalido cuenta como existente). Si tras aplicar esta migracion
-- alguna consulta no usa el indice esperado, verificar con
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- y reconstruirlo con REINDEX INDEX CONCURRENTLY.
-- ---------------------------------------------------------------------------

-- C.10 — `getTimeline`, la unica pantalla forense por orden, consulta por
-- `resource` + `resource_id` ordenando por fecha descendente. NINGUN indice
-- existente sirve ese predicado: los cuatro que hay arrancan por store_id,
-- organization_id, user_id o created_at, de modo que filtrar por recurso obliga
-- hoy a un barrido secuencial.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_resource_resource_id_created_at_idx"
  ON "audit_logs" ("resource", "resource_id", "created_at" DESC);

-- D.0 — Hoy NO existe ningun indice de `products` que incluya `state`, y las
-- fases siguientes encienden un filtro por estado en las agregaciones de
-- valoracion: sin indice el planificador degrada a barrido secuencial al crecer
-- el catalogo.
-- `(state, id)` sirve el barrido global paginado/ordenado por id.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_state_id_idx"
  ON "products" ("state", "id");

-- `(store_id, state)` sirve el mismo filtro dentro de una tienda, que es como
-- lo consultan los reportes con scope de tienda.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_store_id_state_idx"
  ON "products" ("store_id", "state");
