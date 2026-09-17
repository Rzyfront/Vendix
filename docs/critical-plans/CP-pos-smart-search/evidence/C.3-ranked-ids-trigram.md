# C.3 — Evidencia raw trigram rankeado (2026-09-17, dev local)

## Implementación

- `product-search-trigram.util.ts` (puro): recall AND×OR sobre
  `immutable_unaccent(lower(col))` (name/sku/description + variantes) +
  scoring CASE espejo SEARCH_WEIGHTS/bonus + COUNT twin mismo WHERE +
  ORDER BY espejo `compareSearchRank` (score→coverage→featured→
  created_at DESC NULLS LAST→id DESC).
- `products.service.searchIdsRankedTrigram`: ALS-directo + match caller
  (F-004, Forbidden propaga), tx interactiva + `SET LOCAL statement_timeout
  2000ms` (F-070/F-090), slow-log >250ms, histograma `search_latency_ms`
  (F-070), `request_id` como comment SQL sanitizado.
- `findAll`: rama trigram tras L2; Forbidden JAMÁS degrada; resto →
  `unranked_error` genérico (F-085). Hydrate trigram NUDEA el AND×OR de texto
  (el raw ya filtró con acentos; re-aplicarlo vaciaba la página) y conserva
  escalares como segunda cerradura.
- `findIds`: con texto + path trigram usa el raw (limit 1000, total del twin)
  ⇒ DB-17 bajo acentos; throw operativo → fail-open legacy; Forbidden propaga.
- Specs: util 41/41 + servicio 81/81 (72 previas + 9 C.3).
- `src/` tsc limpio (errores solo en `scripts/` pre-existentes).

## Verificación viva (tienda 3 tech-bogota, flag trigram on)

| Caso | Resultado |
|---|---|
| `search=cafe` (EL caso usuario) | 26 `Café Molido Tostado NN E1PAG`, rank-1 `...23 E1PAG`, `layer:trigram ranked`, 189ms |
| /ids vs listado `cafe` | 26/26, diff vacío (DB-17 trigram) |
| Cross-store `playstation` (Roku) | 0, ranked (cero fuga); 26/26 ids en 1 sola tienda |
| `brand_id=1 + cafe` | 0 = ground truth SQL (paridad filtros) |
| `state=archived + cafe` | 0 ranked (vacuoso: 0 archivados en tienda) |
| `nino` | 0 ranked (ñ no colapsa; sin datos ñ en dev — ver F-079) |
| L2 vs trigram rank-1 ×4 (`e1pag`,`molido`,`tostado`,`molido tostado`) | 4/4 idénticos (totales 26/26/23/23 + rank-1 `...23 E1PAG`) |
| p95 trigram dev (50 reqs `cafe` POS) | p50=27ms p95=35ms max=49ms (gate staging <80ms: proxy verde) |

## Gate GIN automatizado (F-101): `scripts/pos-search-explain-gate.sh` → VERDE

1. Catálogo: 2/2 GIN existen + válidos + ready.
2. Indexdef: 2/2 con `gin_trgm_ops` + `immutable_unaccent(lower`.
3. Escala (fixture temporal 50k, 1% match): `Bitmap Index Scan` en el GIN.
4. Cero índices inválidos en la DB (DB-16).
5. Cadena: jest pinea builder == snapshot SQL byte-exacto (el gate corre
   EXPLAIN sobre ese snapshot) — 41/41.

Nota honesta: en la tabla dev (175 filas) el planner prefiere el btree
`store_id` (correcto a esa escala); el gate lo compensa con el fixture 50k.

## F-079 ñ (sin datos ñ en dev + writes bloqueados por subscription gate)

Predicado exacto de producción sobre las funciones reales:
`niño→match`, `nino→no`, `año→match` (`tamaño`), `ano→no`. HTTP-level ñ
pendiente de datos con ñ (re-chequear en E.4/convergencia).

## Hallazgos de implementación (debug vivo, ya fixeados + pineados)

1. **P2010/42P18 `$n` huérfanos**: el adapter Prisma/pg aborta si un query
   recibe params que no referencia. El COUNT pasaba los 7 patrones/token pero
   solo usaba contains. Fix: push en 2 pasadas (contains de todos los tokens
   primero → prefijo contiguo para COUNT) + spec `max $n == params.length`.
2. **42P18 `func() = $n`**: casts explícitos `::text/::int/::boolean/enum`
   en TODO $n (el cast va en el param, el GIN intacto) + spec anti-`$n` pelado.
3. **Hydrate vacía**: nudeo de texto en hydrate trigram (arriba).
4. **Watch-stale**: tras ediciones encadenadas el contenedor sirvió código
   viejo (error migró $3→$4 sin moverse); `docker restart` lo resolvió.
   Lección: ante error que no se mueve, verificar pid/fecha de arranque.

## Divergencia conocida (heredada del plan, no introducida)

Símbolos-adyacentes: la expr canónica pineada (DB-16) no pliega símbolos
(`Café-Especial`: JS `especial`=word 40, SQL=contains 12). Recall idéntico;
solo matiz de tier en palabras hifenadas. Cambiarlo = correctiva C.2b +
decisión de plan (re-auditoría decidirá).
