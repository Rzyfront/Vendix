# A.3 — specs de guardas `cancelDeliveredOrderItem` + red-before-green (2026-09-24)

Verificación acotada y secuencial (un proceso, `--runInBand`) de los specs del step A.3.
Rama `develop`, checkout compartido. Sin commits, sin cambios a `PLAN.md`, sin tocar código ajeno.

## 1. Corridas

### Spec 1 — `order-cancellation-policy.util.spec.ts` → VERDE 46/46

```text
$ npm run buildcheck:test -- src/domains/store/orders/order-flow/order-cancellation-policy.util.spec.ts
start 2026-09-24T01:07:42Z / end 2026-09-24T01:08:00Z / HEAD db689e73a / exit=0
▶ backend-tests  PASS (17s) — Tests: 46 passed, 46 total
```

### Spec 2 — `order-flow.service.spec.ts` → 146/148 (2 rojos D.2, ver §2)

Intento inicial con el tope por defecto (`BUILDCHECK_TEST_MEM=2048`): **OOM** — la suite
(servicio 5686 líneas + spec 3432 líneas bajo ts-jest) murió en ~2045 MB antes de correr
un solo test (`Tests: 0 total`, `FATAL ERROR: Reached heap limit`, log en `/tmp/A3-spec2-OOM.log`).
No se reintentó en loop: un ÚNICO reintento con `BUILDCHECK_TEST_MEM=4096` (mismo comando,
mismo filtro, un proceso) corrió la suite completa en 6 s (caché ts-jest tibia):

```text
$ BUILDCHECK_TEST_MEM=4096 npm run buildcheck:test -- src/domains/store/orders/order-flow/order-flow.service.spec.ts
start 2026-09-24T01:09:07Z / end 2026-09-24T01:09:14Z / HEAD 5f6cf70fb / exit=1
▶ backend-tests  FAIL — Tests: 2 failed, 146 passed, 148 total
```

Nota: entre spec1 y spec2 otros agentes aterrizaron `cab0194fc` y `5f6cf70fb`, ambos
docs-only (`PLAN.md`/ledger). Ningún cambio a `order-flow.*` durante la verificación.

### Guardas A.3 — 10/10 en VERDE (sin mutación)

Describe `cancelDeliveredOrderItem — reversa (1060 paso 2)` (`order-flow.service.spec.ts`):

| Test (línea) | Fija | Estado |
| --- | --- | --- |
| `409 tipado si hay pago {succeeded,captured,partially_refunded,refunded}` ×4 (2284–2298, `errorCode` en 2293) | `ORD_ITEM_CANCEL_PAID_001` + sin tocar tx/stock/auditoría | ✓ |
| `si el cobro entra tras la prelectura…` (2325–2336, `errorCode` en 2333) | `ORD_ITEM_CANCEL_PAID_001` in-tx, sin mutar | ✓ |
| `409 tipado para estado terminal {cancelled,refunded,finished}` ×3 (2338–2350, `errorCode` en 2346 + `details.state` en 2347) | `ORD_ITEM_CANCEL_STATE_001` + `details: {state}` | ✓ |
| `prioriza el estado refunded aunque conserve un pago reembolsado` (2352–2364, 2360–2361) | precedencia `STATE_001` + `details.state='refunded'` | ✓ |
| `pago pendiente no impide cancelar un plato de cuenta abierta` (2366–2374) | pass-through `pending` (tx ×1) | ✓ |

Guardas bajo test: pre-tx `order-flow.service.ts:2936–2957` (terminal `cancelled`/`refunded`
→ pago settled vía `SETTLED_PAYMENT_STATES` → `finished`) e in-tx `:3027–3046`
(re-chequeo bajo lock). Códigos en `error-codes.ts:5702–5710`.

## 2. Los 2 rojos D.2 — preexistentes, NO tocados

| Test | Esperado (spec) | Recibido (servicio `:3011–3012`) |
| --- | --- | --- |
| `restock: devuelve stock…` (spec `:2408`) | `cancellation_type: 'before_fire'` | `'after_fire_reused'` |
| `waste: NO toca stock…` (spec `:2446`) | `cancellation_type: 'before_fire'` | `'after_fire_waste'` |

Asumidos por el stream D.2. No se modificaron ni se "arreglaron" en esta verificación.

## 3. Red-before-green — Intento A (mutación real) RINDIÓ

Intento B (prueba estática) no fue necesario: jest sí corre con heap suficiente.

**Mutación** (backup `/tmp/ofs.bak`, `md5 66b0b5f8ebc4bf64e67f98860f52f2b6`):
solo las guardas de `cancelDeliveredOrderItem` revertidas a la forma muerta de
`3442b1a1c` — pre-tx a `(order as any).payment_status === 'paid'` +
`BLOCKED_STATES = ['completed','cancelled','refunded']` con
`TABLE_SESSION_ITEM_NOT_REMOVABLE`, y re-chequeos in-tx eliminados (no existían
entonces; `assertUnsplitOrderAfterLock` conservado). Diff: 1 archivo, +11/−39,
solo `order-flow.service.ts:2931–2951,3015–3021`.

**Resultado mutado** (mismo comando heap-bumped, `01:10:28Z–01:10:43Z`, HEAD `5f6cf70fb`):

```text
Tests: 12 failed, 136 passed, 148 total   (baseline: 2 failed, 146 passed)
```

Nuevos rojos (+10, todos de guardas): 4× pago settled, 1× cobro in-tx, 3× estado
terminal, 1× precedencia refunded, más `orden cobrada rechaza antes de inventario…`
(spec `:2712`, guarda `PAID_001` vía ruta prepared D.2). Los 2 D.2 siguen rojos por
la misma causa. Siguen verdes por diseño/alcance: pass-through `pending`, 2× split
lock, 422/409/404/idempotencia y demás describes — la mutación fue quirúrgica.

**Restauración verificada:**

```text
$ cp /tmp/ofs.bak apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts
$ git diff --stat -- apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts
(vacío = 0 cambios; md5 idéntico al backup; `git status` limpio en order-flow/)
```

Conclusión: el spec de rechazo fija el fix — con guardas muertas, los 10 tests de
rechazo A.3 (+D.2-paid) van a ROJO; con guardas vivas, 10/10 en verde.

## 4. Logs

- `/tmp/A3-spec1-73038.log` + `/tmp/A3-spec1-jest.log` — spec1 PASS 46/46.
- `/tmp/A3-spec2-OOM.log` — spec2 OOM con tope 2048 (0 tests).
- `/tmp/A3-spec2r-74241.log` + `/tmp/A3-spec2-jest.log` — spec2 146/148.
- `/tmp/A3-mut-79593.log` + `/tmp/A3-mut-jest.log` — mutado 136/148.
- `/tmp/ofs.bak` — backup bit-identico del servicio (restaurado, diff 0).
