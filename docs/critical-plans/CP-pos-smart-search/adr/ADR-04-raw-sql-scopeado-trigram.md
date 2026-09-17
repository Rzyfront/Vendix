---
id: ADR-04
title: "Raw SQL scopeado para trigram (Fase B)"
status: proposed
reversibility: costly
updated: 2026-09-17
---
# ADR-04 — Raw SQL scopeado para trigram (Fase B)

- **Context:** Prisma no expresa unaccent/similarity/ts_rank ni ORDER BY por score. Intentar el where con AND de contains por token seguiría sin índice y sin ranking.
- **Decision:** searchIdsRanked(storeId,filters,tokens,limit) con `$queryRawUnsafe` SOLO placeholders $1..$n (cero interpolación, gate grep) + `ESCAPE '\'`; store_id entero+ desde ALS directo o Forbidden (fail-closed, jamás fallback estático/DTO); expresión canónica `immutable_unaccent(lower(col))` idéntica al GIN per-columna; full filter-set AND + rama OR description acotada + COUNT twin con predicate-builder compartido; rank SEARCH_WEIGHTS (A.2); `ORDER BY rank DESC, id ASC`; statement_timeout + slow-log; errores→genérico/fallback Fase A. Prisma hidrata por id:{in} y re-ordena.
- **Consequences:** Matching+ranking en index scan por tenant (BitmapAnd con btree store_id). Se pierde auto-scope en esa query: filtro manual obligatorio + 2 negativos cross-tienda + probe GIN.
- **Reversibility:** costly — revertir deja migración aplicada; el código vuelve a la rama Fase A por flag TRIGRAM off sin tocar DB.
- **Revisit if:** Prisma añade soporte de full-text nativo; entonces migrar la query al where tipado.
