# Evidence — E.4 Full rollout + métricas + audit (2026-09-17)

## F-069 — Señal CTR/posición (major) ✅

- Migración `20260917131000_add_pos_search_selections` (CREATE TABLE
  aditiva, 0 filas tocadas, sin FKs, idempotente) + modelo Prisma +
  getter scoped en StorePrismaService + `pos_search_selections` en
  store_scoped_models (lecturas/escrituras acotadas por tienda).
- Endpoint `POST /store/products/search-selections`
  (`@Permissions('store:products:read')`, DTO-first, 201 via
  ResponseService.created). Tenant/user desde contexto, nunca del body.
- Emitter web POS: `pos-product.service.logSearchSelection` (sha256 de query
  normalizada vía crypto.subtle; la cruda jamás sale) + hook al tope de
  `onAddToCart` (solo bajo search activo; fire-and-forget con catch).
- Specs backend 13/13 (DTO 10 + servicio 3).
- Vivo: POST → 201 + fila (store 10, user del token); hash inválido → 400
  SYS_VALIDATION_001; distribución posiciones 1:2/2:1/7:1.
- Denominador CTR: `audit_logs` ya audita SEARCH|products con query en
  metadata (descubierto vivo). Join validado con pgcrypto (normalización
  SQL↔JS con paridad probada).
- Dashboard queries (validadas en dev):
  - Distribución: `SELECT position, count(*) FROM pos_search_selections
    WHERE store_id=? GROUP BY 1 ORDER BY 1`
  - CTR top-1/top-3 por query-hash: join searches-hashed (audit) ×
    selections (ver evidencia completa en el commit: CTE searches/sel).
- Gate 1 semana: a partir del deploy con emitter, recolectar 7 días de
  (query-hash, posición, rank_mode) por superficie ANTES de recalibrar
  pesos. Regla: ningún cambio de pesos sin CTR top-1/top-3 semanal por
  superficie; deriva = mediana de posición por query-hash al alza.

## F-094 — Interleaving refresh × search (minor) ✅

- Guards verificados: filterProducts nunca limpia la grilla, skeleton solo
  con grilla vacía, seq-guard descarta respuestas viejas, refreshTrigger
  embuda por el mismo loadProducts().
- E2E `apps/frontend/e2e/pos-search-interleaving.spec.ts`: login UI real,
  siembra `cafe` ([286]), retrasa 1.5s la respuesta de `oster`, sondea que
  cards>0 durante todo el vuelo, aserta rank final [287,286] rank-1
  Licuadora. **VERDE** (4.3s, chromium, seed roku).
- Nota dataset: `is_sellable=true` del POS excluye 334; `cafe sello` daría
  0 filas (correcto) por eso la matriz usa `oster`.

## Barrido superficies (FB-01/10/11/12/14)

- FB-01 products `cafe`: total 2 [334,286], meta.search ranked/l2.
- FB-10 ajustes: 2 [334,286]. FB-11 traslados: 2 [334,286].
- FB-12 catalog: total 1, applied [cafe].
- FB-14 mobile-shape (pos_optimized+variants+page 2): 200.

## Auditoría de toggles

- PATCH l2 off→on: filas `POS_SMART_SEARCH_TOGGLE|settings` por cambio
  (una por flag tocado). Flags restaurados a {l1,l2:true, trigram:false}.
