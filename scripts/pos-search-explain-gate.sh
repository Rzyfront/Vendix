#!/usr/bin/env bash
# CP-pos-smart-search · C.3 — Gate GIN automatizado (F-101).
#
# No confía en el archivo de migración: verifica en el CATÁLOGO que los GIN
# existen, están válidos y portan la expresión canónica, y en un FIXTURE DE
# ESCALA (50k filas) que el planificador sirve el LIKE '%x%' canónico con
# Bitmap Index Scan (en la tabla dev de 175 filas el planner prefiere el
# btree store_id — correcto a esa escala, inútil como gate).
#
# Uso: ./scripts/pos-search-explain-gate.sh   (requiere vendix_postgres local)
set -euo pipefail

PSQL=(docker exec -i -e PGPASSWORD=password vendix_postgres psql
  -U username -d vendix_db -v ON_ERROR_STOP=1 -t -A)
FAIL=0

echo "== 1/3 catálogo: existen + válidos =="
COUNT=$(docker exec -e PGPASSWORD=password vendix_postgres psql \
  -U username -d vendix_db -v ON_ERROR_STOP=1 -t -A -c \
  "SELECT count(*) FROM pg_index WHERE indexrelid::regclass::text IN \
   ('products_search_name_trgm_idx','products_search_sku_trgm_idx') \
   AND indisvalid AND indisready;")
echo "válidos+ready: $COUNT/2"
[ "$COUNT" = "2" ] || { echo "GATE ROJO: faltan GIN válidos" >&2; FAIL=1; }

echo "== 2/3 catálogo: expresión canónica + opclass =="
DEF_OK=$(docker exec -e PGPASSWORD=password vendix_postgres psql \
  -U username -d vendix_db -v ON_ERROR_STOP=1 -t -A -c \
  "SELECT count(*) FROM pg_indexes WHERE indexname IN \
   ('products_search_name_trgm_idx','products_search_sku_trgm_idx') \
   AND indexdef ILIKE '%gin_trgm_ops%' \
   AND indexdef ILIKE '%immutable_unaccent(lower%';")
echo "canónicos: $DEF_OK/2"
[ "$DEF_OK" = "2" ] || { echo "GATE ROJO: indexdef no canónica" >&2; FAIL=1; }

INVALID=$(docker exec -e PGPASSWORD=password vendix_postgres psql \
  -U username -d vendix_db -v ON_ERROR_STOP=1 -t -A \
  -c "SELECT count(*) FROM pg_index WHERE NOT indisvalid;")
echo "inválidos (toda la DB): $INVALID"
[ "$INVALID" = "0" ] || { echo "GATE ROJO: índices inválidos (DB-16)" >&2; FAIL=1; }

echo "== 3/3 escala: LIKE canónico usa GIN (fixture 50k, temporal) =="
PLAN=$("${PSQL[@]}" <<'EOF'
CREATE TEMP TABLE pos_search_gate_scale (id serial PRIMARY KEY, name text NOT NULL);
INSERT INTO pos_search_gate_scale (name)
  SELECT CASE WHEN g % 100 = 0
    THEN 'Producto ' || g || ' cafe molido tostado ' || md5(g::text)
    ELSE 'Producto ' || g || ' ' || md5(g::text) || ' ' || md5((g+1)::text)
  END FROM generate_series(1, 50000) g;
CREATE INDEX gate_scale_trgm ON pos_search_gate_scale
  USING gin (public.immutable_unaccent(lower(name)) gin_trgm_ops);
VACUUM (ANALYZE) pos_search_gate_scale;
EXPLAIN (COSTS OFF)
  SELECT id FROM pos_search_gate_scale
  WHERE public.immutable_unaccent(lower(name)) LIKE '%cafe molido%' ESCAPE '\'
  LIMIT 20;
EOF
)
echo "$PLAN"
echo "$PLAN" | grep -q "Bitmap Index Scan on gate_scale_trgm" \
  || { echo "GATE ROJO: el GIN no sirve el LIKE canónico a escala" >&2; FAIL=1; }

if [ "$FAIL" = "0" ]; then
  echo "GATE VERDE: GIN name+sku existen/válidos/canónicos y sirven LIKE a escala"
fi
exit "$FAIL"
