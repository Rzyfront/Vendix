-- DATA IMPACT:
-- Tables affected: products (solo indices, ninguna columna/fila tocada)
-- Expected row changes: 0
-- Destructive operations: ninguna
-- FK/cascade risk: ninguno
-- Idempotency: CREATE INDEX CONCURRENTLY IF NOT EXISTS — re-ejecutable sin error
--   EXCEPTO si un build previo dejo el nombre INVALID (F-082): IF NOT EXISTS lo
--   respeta y sale verde sin indice. Ver INVALID abajo: nunca retry ciego.
-- Reversibility: DROP INDEX CONCURRENTLY IF EXISTS products_search_name_trgm_idx;
--   DROP INDEX CONCURRENTLY IF EXISTS products_search_sku_trgm_idx;
-- Approval: plan critico CP-pos-smart-search, paso C.2 — checkpoint E.2 TRIGRAM firmado 2026-09-17
-- Scope: C.2 — GIN trigram por expresion canonica (name, sku). Description va por
--   rama OR no-indexada en C.3 (F-027, seq-scan acotado por store_id, documentado).

-- ---------------------------------------------------------------------------
-- CP-pos-smart-search · C.2 — GIN trigram CONCURRENTLY
--
-- APLICACION: este archivo es solo-CONCURRENTLY y NO corre via `migrate dev`
-- (Prisma envuelve en transaccion y CONCURRENTLY muere — F-031). Aplicar con
-- el runbook del precedente 20260914170851 (ver evidence/C.1-runbook-deploy.md
-- y evidence/C.2-runbook-gin.md):
--
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f <este archivo>   (SIN transaccion)
--   npx prisma migrate resolve --applied <nombre_migracion>
--
-- Deploy prod (`migrate deploy`) SI aplica sin transaccion envolvente para
-- este archivo (memoria #2085, PR #811): CONCURRENTLY es valido ahi.
--
-- F-002: UN GIN por columna de texto, jamas compuesto con integer (sin opclass
-- GIN para integer sin btree_gin). El tenant-pruning lo hace el planificador
-- via BitmapAnd con los btree existentes de store_id (ver EXPLAIN en C.3).
--
-- Expresion canonica (pactada con A.1/C.3, DB-16):
--   immutable_unaccent(lower(col))
-- El wrapper es IMMUTABLE (C.1), requisito para indexar la expresion.
--
-- INVALID (F-082 / DB-16): si un build CONCURRENTLY falla deja
-- `indisvalid=false`. NO reintentar con IF NOT EXISTS (sale verde sin crear
-- nada). Recuperacion duena:
--   REINDEX INDEX CONCURRENTLY <nombre>;   -- o DROP + re-ejecutar este archivo
-- Gate post-deploy (falla si no vacio):
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- ---------------------------------------------------------------------------

CREATE INDEX CONCURRENTLY IF NOT EXISTS products_search_name_trgm_idx
  ON public.products USING gin (public.immutable_unaccent(lower(name)) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS products_search_sku_trgm_idx
  ON public.products USING gin (public.immutable_unaccent(lower(sku)) gin_trgm_ops);
