# A.4 — Backend specs: cancelación draft + policy (evidencia)

- Step: A.4 de CP-pos-order-flows-remediation (solo verificación, SOLO LECTURA en código)
- Fecha (UTC): 2026-09-24
- Rama: `develop` (checkout compartido; HEAD se movió durante la sesión: `3577e7257` → `4bebaacab`; cada corrida anota su HEAD)
- Agente: A.4 backend specs verifier
- Alcance corrido: `order-cancellation-race.integration.spec.ts` + `orders.service.spec.ts`.
  NO se re-corrieron `order-flow.service.spec` ni `order-cancellation-policy.util.spec`
  (verdes en A.3: 146/148 con solo 2 rojos D.2 + 46/46).

## 1. Corridas (secuencial, un proceso, heap 4096 desde el inicio)

### 1.1 Race spec — `order-cancellation-race.integration.spec.ts`

Comando prescrito (vía wrapper):

```bash
BUILDCHECK_TEST_MEM=4096 npm run buildcheck:test -- src/domains/store/orders/order-flow/order-cancellation-race.integration.spec.ts
```

| # | Inicio UTC | Fin UTC | HEAD | Resultado wrapper |
|---|------------|---------|------|-------------------|
| 1 | 2026-09-24T01:13:37Z | ~01:2xZ | `3577e7257` | `backend-tests PASS (11s)`, `RESULTADO: PASS`, exit 0 |
| 2 | 2026-09-24T01:29:01Z | 2026-09-24T01:29:07Z | `4bebaacab` | `backend-tests PASS (6s)`, `RESULTADO: PASS`, exit 0 |

El wrapper no imprime conteos (van al log compartido `.buildcheck/backend-tests.log`,
que en checkout compartido NO es confiable: al inspeccionarlo contenía la corrida OOM
de OTRO agente sobre `addresses.service.spec.ts`, ver §1.3). Conteos obtenidos con el
jest directo equivalente al que invoca `scripts/buildcheck.sh` (mismo binario, mismos
flags `--runInBand --ci --forceExit`, mismo heap):

```bash
cd apps/backend && node --max-old-space-size=4096 ../../node_modules/.bin/jest \
  src/domains/store/orders/order-flow/order-cancellation-race.integration.spec.ts \
  --runInBand --ci --forceExit
# 2026-09-24T01:29:11Z → 01:29:16Z, HEAD 4bebaacab, exit=0
# Test Suites: 1 skipped, 0 of 1 total
# Tests:       7 skipped, 7 total
# Snapshots:   0 total
# Time:        5.38 s
```

**Estado: SKIP por diseño (7 skipped, 0 corridos, exit 0). NO es evidencia de pass.**

Bloqueo exacto (documentado, no intentado el opt-in):

- El spec usa `describe.skip` salvo `VENDIX_LOCAL_RACE_TEST=1`
  (`order-cancellation-race.integration.spec.ts:22-24`).
- Ambas variables sin setear: `VENDIX_LOCAL_RACE_TEST=<unset>`,
  `VENDIX_LOCAL_RACE_DATABASE_URL=<unset>`.
- El único Postgres loopback disponible es la **DB de desarrollo compartida**
  (`vendix_postgres`, Up 9h, `0.0.0.0:5432->5432/tcp`; puerto 5432 OPEN).
  No existe DB de test dedicada. El opt-in crearía schemas `qa_cancel_*` sobre la
  DB compartida de dev mientras otros agentes trabajan → fuera del mandato
  read-only; no se ejecutó.
- El propio header del spec lo declara: *"skipped runs are not evidence"*
  (`order-cancellation-race.integration.spec.ts:16-21`).

Aclaración de alcance: este spec **NO** prueba el claim atómico `draft→cancelled`.
Sus fixtures corren `pending_payment→cancelled/processing` y prueban el contrato
lock-real + policy (orden de `FOR UPDATE`, re-lectura autoritativa, rollback,
reconciliación). El claim atómico con `draft` en el WHERE vive en
`cancelOrder` (`order-flow.service.ts:3874-3877`, `claimableStates` ←
`CANCELABLE_STATES` que incluye `draft`) y su cobertura unitaria está en
`order-flow.service.spec.ts` (verde en A.3, no re-corrido por instrucción).

### 1.2 OrdersService spec — `orders.service.spec.ts` (cubre cancelación/policy)

```bash
cd apps/backend && node --max-old-space-size=4096 ../../node_modules/.bin/jest \
  src/domains/store/orders/orders.service.spec.ts \
  --runInBand --ci --forceExit
# 2026-09-24T01:29:34Z → 01:29:42Z, HEAD 4bebaacab, exit=0
# PASS src/domains/store/orders/orders.service.spec.ts (7.447 s)
# Test Suites: 1 passed, 1 total
# Tests:       107 passed, 107 total
# Snapshots:   0 total
# Time:        7.79 s, estimated 12 s
```

**Estado: VERDE — 107/107, 0 fallos.** Sin OOM en ninguna corrida (heap 4096 suficiente).

Cobertura de cancelación/policy incluida en esos 107 (constatada en fuente, no modificada):

- `orders.service.spec.ts:515-584` — bloque `read-side cancellation policy` (3 tests):
  policy por orden en listado sin N+1 (`ORD_CANCEL_STOCK_COMMITTED_001` /
  `null` / `ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001`), mismo bloqueador
  monetario en detalle sin lookup extra de payments, y preservación de policy
  para pago cash (`DIRECT`/`cash` → `can_cancel: true`).
- Read-side real cableado en `orders.service.ts:55` (import),
  `:974` (listado `findAll`) y `:1307` (detalle `findOne`).

Ningún test existente falló → ningún contrato que reportar como rojo.

### 1.3 Nota de higiene: log compartido no confiable (constatado)

`.buildcheck/backend-tests.log` (mtime coincidente con mi corrida) contenía un FAIL
con `heap out of memory` sobre `src/domains/store/addresses/addresses.service.spec.ts`
de otro agente concurrente — NO de mi corrida (la mía reportó PASS para el race
spec). Por eso los conteos de §1.1/§1.2 se tomaron de stdout directo a `/tmp`
(`/tmp/a4-race-jest.log`, `/tmp/a4-orders-service-jest.log`), no del log compartido.
No se reclama PASS por línea de log ajena: cada veredicto aquí trae su `exit=` y
su HEAD tomados en la misma llamada.

## 2. Fuente única: `CANCELABLE_ORDER_STATES` (verificada)

Definición única — `apps/backend/src/domains/store/orders/order-flow/order-cancellation-policy.util.ts`:

- `:34-36` — `export const CANCELABLE_ORDER_STATES = ['draft', 'created', 'pending_payment', 'processing']`
- `:37` — `const CANCELABLE_STATES = new Set<string>(CANCELABLE_ORDER_STATES)` (lado lectura)
- `:107` — `getOrderCancellationPolicy` usa `CANCELABLE_STATES.has(order.state)`

Consumo en escritura — `apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts`:

- `:7` — importa `CANCELABLE_ORDER_STATES` del util (no literal propio)
- `:110` — `const CANCELABLE_STATES: OrderState[] = [...CANCELABLE_ORDER_STATES]` (spread, sin duplicar el set)
- `:92` — arista `draft: ['created', 'cancelled']` en `VALID_TRANSITIONS`
- `:3698-3700` — `claimableStates` por defecto = `CANCELABLE_STATES`
- `:3704` — fast-path guard pre-tx con `CANCELABLE_STATES.includes(previousState)`
- `:3834` — reasignación in-tx post re-lectura (`force ? [previousState] : CANCELABLE_STATES`)
- `:3874-3877` — claim atómico `tx.orders.updateMany({ where: { id, state: { in: claimableStates } } })`

**`draft` incluido en ambos lados** (definición `:34-36` y consumo vía spread `:110`
→ claim `:3874-3877`). Grep en `apps/backend/src/domains/store/orders/` (excluyendo
`*.spec.ts`) no muestra ningún otro literal del set cancelable de 4 estados.

Observaciones (fuera de alcance A.4, no se tocan — mandato read-only):

1. `cancelPayment` usa literales inline `['pending_payment', 'processing']`
   (`order-flow.service.ts:1773,1782`) mientras el util tiene el set privado
   `PAYMENT_CANCELABLE_STATES` (`order-cancellation-policy.util.ts:38`). Misma
   forma de duplicación ya corregida para el set de orden, pero en el sub-flujo
   de pago. Candidato a unificar en otro step.
2. Docstring de `cancelOrder` (`order-flow.service.ts:3649`) dice
   *"(from created, pending_payment, or processing)"* — omite `draft`, que SÍ es
   cancelable. Comentario rancio, el código es correcto.

## 3. ERR-43 `ORD_CANCEL_OPEN_TABLE_001` (verificado) y ERR-38 (constatado)

### ERR-43 — `ORD_CANCEL_OPEN_TABLE_001` ✅ existe, 409, con `details.table_session_id`, antes del claim

- Registro: `apps/backend/src/common/errors/error-codes.ts:1103-1107`
  (`code`, `httpStatus: 409`).
- Único lanzador: `assertNoOpenTableForDraft` (`order-flow.service.ts:378-394`):
  solo actúa si `order.state === 'draft'` (`:382`), busca sesión abierta
  (`:383-386`) y lanza con `details: { table_session_id: session.id }` (`:388-392`).
- Orden respecto al claim — ambas llamadas preceden al claim atómico (`:3874`):
  - `:3684` — pre-tx (fail fast, fuera de la transacción);
  - `:3817` — in-tx, tras `lockOrderLifecycle` + re-lectura fresca (`:3816`),
    y ANTES de `assertCancellationAllowed` (`:3818`) y del claim (`:3874`).
- Espejo read-side: `getOrderCancellationPolicy` devuelve
  `reason_code: 'ORD_CANCEL_OPEN_TABLE_001'` para draft con sesión abierta
  (`order-cancellation-policy.util.ts:100-105`); cubierto por
  `order-cancellation-policy.util.spec.ts:59-67` (verde en A.3).
- Copy UX frontend existe: `apps/frontend/src/app/core/utils/error-messages.ts:273-274`.

### ERR-38 — `ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001` (solo constata; cierra en I.2)

- El código **existe**: `error-codes.ts:1098-1102` (`httpStatus: 409`).
- Se lanza en:
  - `getCancellationBlocker` (`order-cancellation-policy.util.ts:91-93`) → vía
    `assertCancellationAllowed` (`order-flow.service.ts:373-376`), invocado en
    `cancelOrder` in-tx (`:3818`) y en `cancelPayment` (`:1785`);
  - `cancelOrder` in-tx directo `:3824` (pago liquidado no-efectivo) y `:3854`
    (monto cash no verificable).
- Read-side + specs: `orders.service.spec.ts:529,559` lo asertan (verdes, §1.2);
  copy UX existe (`error-messages.ts:271-272`).
- No se emite juicio de cierre aquí: **I.2 decide**.

## 4. Veredicto A.4-backend-specs

| Ítem | Estado |
|------|--------|
| Race spec (lock+policy PG) | SKIP por diseño — 7 skipped / exit 0 — opt-in + DB test dedicada no disponibles; no es evidencia de pass ni de fail |
| OrdersService spec (cancel/policy) | VERDE — 107/107, exit 0, HEAD `4bebaacab` |
| Fuente única `CANCELABLE_ORDER_STATES` | OK — `draft` en ambos lados, sin duplicación del set |
| ERR-43 `ORD_CANCEL_OPEN_TABLE_001` | OK — 409 + `details.table_session_id`, antes del claim (2 call sites) |
| ERR-38 `ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001` | CONSTATADO existe + 4 sitios de lanzamiento; cierre en I.2 |
| Tests rojos / contratos rotos | Ninguno |

No se modificó ningún archivo de código, ningún test ni `PLAN.md`. Único archivo
nuevo: este.
