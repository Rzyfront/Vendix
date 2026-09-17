# E.2 — Evidencia gate Fase A (2026-09-17, dev local)

## 1. E2E cajero web (Playwright, https://vendix.com)

Tiendas: Roku (Rafa Martinez) + tech-bogota (seed owner@techsolutions.co).

| Caso | Query | Resultado |
|---|---|---|
| Orden relevancia, tokens invertidos | `slim playstation` | rank-1 `PlayStation 5 Slim 1TB`, `mejores coincidencias primero` |
| Parcial | `Play s` | 1 resultado correcto |
| Paginación | (vacío) | `Mostrando 20 de 90`, `Cargar más (70 restantes)` → click → `40 de 90` |
| Paginación 2ª tienda | (vacío) | `Mostrando 20 de 29`, `Cargar más (9 restantes)` |
| Total real de meta (F-023) | `e1pag` | `Mostrando 20 de 26`, `26 resultados para 'e1pag'` |
| Vacío ERR-01 | `zzzqqqxxx` | `No se encontraron productos` + botón `Limpiar búsqueda` + live-region |
| Keyboard-only (F-053) | `e1pag` + Enter | rank-1 al carrito, Subtotal $10.000 |
| Tormenta recursión | sesión completa | 11 reqs `/products`, 1:1 con acciones (fix `untracked()` en effects; antes: 301/17s) |
| Consola | — | 0 errors (1 warning pre-existente; 403 `uvt-threshold` en Roku es ajeno al POS y pre-existente) |

## 2. Móvil (superficie API, FB-14)

`GET /store/products?search=e1pag&state=active` → `HTTP 200` en 23ms, `rank_mode: ranked`.
Paridad UI móvil completa = E.3 (corre tras E.2 por plan).

## 3. Admin/bulk rankeados + DB-17

- Admin sin `pos_optimized`, `search=e1pag`, limit 50 → 200, n=26, total=26, `ranked`.
- `GET /store/products/ids` mismo filtro → 26 ids, `total: 26, capped: false`.
- `diff` conjunto listado vs `/ids` → **IGUALES** (DB-17 ✅, `findAll`≡`findIds`).

## 4. p95/keystroke (dev local, proxy del gate staging <250ms)

50 búsquedas secuenciales POS (`search=e1pag`, pos_optimized, stock, sellable):

- n=50, min=14ms, **p50=18ms, p95=34ms**, max=457ms (outlier frío, 1ª req)
- Veredicto: **PASA** con 7x margen. Re-medir en staging tras C (gate formal).

## 5. Tasa L1-vacío

- No existe contador dedicado en Fase A (solo `search_degraded_total{scan_cap,rank_error}`,
  sin endpoint `/metrics` expuesto en dev → 0 degradaciones observadas en toda la sesión E2E:
  ningún `meta.search.degraded=true`, ningún fallback visible).
- Empírico E2E: único vacío inesperado = `cafe`→`Café` = 0 resultados **por diseño**
  (unaccent es C.1/C.3; legacy idéntico ⇒ paridad, no regresión).
- Nota checkpoint: considerar contador `l1_empty` en C.3/E.4 para medir tasa real en prod.

## 6. Checkpoint B — veredicto: **TRIGRAM** (Fase B)

Firmado 2026-09-17. Razones:

1. Objetivo 1 (tilde-insensibilidad) imposible en Fase A: probado `cafe`→0 filas en L2
   con 20+ `Café*` en tienda. Solo `unaccent` (C.1) + GIN (C.2) + raw (C.3) lo cierra.
2. Objetivos 2,3,4,7 verdes en Fase A (recall tokenizado, rank, paginación, a11y).
3. Riesgo Fase B acotado: migraciones aditivas, trigram default-off + capability guard,
   kill-switch global intacto.
4. A-como-final dejaría el caso canónico español (`cafe`) roto: inaceptable para caja.

Activación L1→L2 por tienda: flags tech-bogota/Roku ya on en dev durante E2E;
prod difiere a E.4 (rollout) tras C.3.
