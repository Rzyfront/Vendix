-- DATA IMPACT:
-- Tables affected: pos_search_selections (NUEVA, vacía)
-- Expected row changes: 0 (CREATE TABLE no toca filas existentes)
-- Destructive operations: ninguna
-- FK/cascade risk: ninguno (tabla sin FKs, sin padres ni hijos)
-- Idempotency: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS — re-ejecutable sin error
-- Reversibility: DROP TABLE IF EXISTS pos_search_selections (solo telemetría; sin consumidores de negocio)
-- Approval: plan critico CP-pos-smart-search, paso E.4 (F-069)
-- Scope: E.4 — log append-only de selecciones del buscador para CTR-por-posición.
--   Aditiva: codigo viejo + DB nueva es seguro (el emitter es fire-and-forget con catch).

-- ---------------------------------------------------------------------------
-- CP-pos-smart-search · E.4 (F-069) — pos_search_selections
--
-- Sin FKs a propósito (convención audit_logs): una fila de telemetría jamás
-- debe bloquear un delete de producto/tienda/usuario. La query cruda nunca se
-- persiste (query_hash = sha256 hex de la query normalizada).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "pos_search_selections" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "user_id" INTEGER,
  "query_hash" VARCHAR(64) NOT NULL,
  "position" INTEGER NOT NULL,
  "product_id" INTEGER NOT NULL,
  "result_count" INTEGER NOT NULL,
  "rank_mode" VARCHAR(24) NOT NULL,
  "flags" JSONB,
  "surface" VARCHAR(16) NOT NULL DEFAULT 'pos_web',
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pos_search_selections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pos_search_selections_store_id_created_at_idx"
  ON "pos_search_selections" ("store_id", "created_at");

CREATE INDEX IF NOT EXISTS "pos_search_selections_store_id_query_hash_created_at_idx"
  ON "pos_search_selections" ("store_id", "query_hash", "created_at");
