# C.2 — Runbook GIN + benchmark + teardown (2026-09-17, dev local)

Migración: `20260917113922`→ C.1; `20260917114144_pos_search_trgm_idx` (este paso).

## Índices creados

- `products_search_name_trgm_idx`: GIN (`immutable_unaccent(lower(name)) gin_trgm_ops`)
- `products_search_sku_trgm_idx`: GIN (`immutable_unaccent(lower(sku)) gin_trgm_ops`)
- F-002: un GIN por columna de texto; tenant-pruning vía BitmapAnd con btree
  `store_id` existentes (ver EXPLAIN en C.3).
- F-027: `description` NO indexada en oleada 1 → rama OR no-indexada en C.3
  (seq-scan acotado por `store_id`, documentado).

## Aplicación real (F-031)

Vía psql + resolve (precedente `20260914170851`, fila `ok=t` en
`_prisma_migrations`, igual que la nuestra):

```bash
docker exec -i -e PGPASSWORD=password vendix_postgres psql -U username \
  -d vendix_db -v ON_ERROR_STOP=1 -f - < migration.sql   # SIN transacción
cd apps/backend && npx prisma migrate resolve --applied 20260917114144_pos_search_trgm_idx
```

Build dev (175 filas): name 6.8ms, sku 1.6ms. `indisvalid`: 0 filas ✅.
EXPLAIN confirma `Bitmap Index Scan on products_search_name_trgm_idx` ✅.

## Gates (dev-proxy; formal en clon staging del mayor tenant)

| Gate | Dev (175 filas) | Bench 10k scratch | Veredicto |
|---|---|---|---|
| Build ≤30min | ~8ms total | 74.7ms / 10k | ✅ proxy; formal en staging |
| GIN ≤3x tabla | 144kB / 64kB = 2.25x | 1144kB / 904kB = 1.27x | ✅ |
| Post-deploy indisvalid vacío | 0 filas | — | ✅ |

## Benchmark import 10k (F-048, tabla UNLOGGED scratch, filas ~90 chars)

- INSERT 10k sin índice: **7.6ms**
- INSERT 10k con GIN trigram: **72ms** → write-amp **~9.4x**
- GIN post-build: 1144kB (1.27x heap); post-insert con pending-list: ~5MB
- Conclusión: imports masivos (bulk/catalog-normalizer) pagan ~9x por lote;
  aceptable en dev; medir en staging con filas reales. `bulk` corre fuera de
  hora pico por diseño existente.

## VACUUM / pending-list (F-048)

- GIN usa fastupdate: los inserts van a pending-list y las búsquedas la
  barren hasta el merge. Tras imports masivos: `VACUUM (ANALYZE) products;`
  (merge + stats; no se espera shrink de tamaño — medido: 4480kB pre/post).
- `gin_pending_list_limit` default (4MB) se conserva; subirlo solo si staging
  muestra regresión p95 post-import (gate C.3).
- Decisión fastupdate: NO desactivar (write-amp sin fastupdate es peor).

## Teardown (rollback dueño)

```sql
DROP INDEX CONCURRENTLY IF EXISTS products_search_name_trgm_idx;
DROP INDEX CONCURRENTLY IF EXISTS products_search_sku_trgm_idx;
-- Si INVALID a la mitad: REINDEX INDEX CONCURRENTLY <nombre>; (nunca retry IF NOT EXISTS — F-082)
-- Gate post-deploy (falla si no vacío):
-- SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
```
