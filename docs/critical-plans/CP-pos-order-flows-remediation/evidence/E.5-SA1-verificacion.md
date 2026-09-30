# E.5-SA1 — Verificación sin login: lo de Fabio sigue verde

Verificador E5, sin login (API/browser prohibidos por throttle 429 caliente).
Método: 1 spec backend acotado + lectura de specs/fuentes + auditoría de
evidencias commiteadas + SQL solo-lectura. No se commiteó, no se editaron
fuentes, no se tocó registry/log/steps ajenos.

HEAD durante la verificación: `41e4413e` (spec) → `aa32bfa1` (SQL).
UTC: 2026-09-24T01:17:58Z–01:18:54Z. Checkout compartido: HEAD se movió
entre pasos por trabajo de peers; no se hizo stash/reset.

## 1) Spec backend ERR-04 — INFRA (OOM), verificado por lectura

- Comando (uno solo, runner acotado del repo):
  `npm run buildcheck:test -- src/domains/store/payments/payments.service.spec.ts`
- Log propio: `/tmp/buildcheck-E5-SA1-55786.log` (evita colisión con
  `.buildcheck/` compartido). Exit=1, 17s, 0 tests corridos.
- Causa: OOM del worker jest, no fallo de código:
  `Mark-Compact 2030.8 (2051.9) MB → FATAL ERROR: JavaScript heap out
  of memory`, worker pid 55923 terminado con SIGTERM. Tope
  `BUILDCHECK_TEST_MEM=2048` alcanzado con `ts-jest` en checkout
  compartido. Precedente A.1: se reporta como infra y se verifica por
  lectura.
- Verificación por lectura (sustituye al run verde):
  - Gate en `apps/backend/src/domains/store/payments/payments.service.ts:763-779`:
    `deliveryIntent` (home_delivery, o dirección con tipo nulo/direct)
    sin `shipping_method_id` → `ORD_SHIP_REQUIRED_FOR_FLOW_001` con
    mensaje ES "Selecciona un método de envío antes de guardar o
    cobrar esta venta.", antes de abrir la transacción.
  - Tests en `payments.service.spec.ts:1195-1222`: 3 casos de rechazo
    tipado (`errorCode` exacto + `$transaction` no llamado) y 5 casos
    de carril válido que llegan al sentinel (`mostrador {}`, default
    `direct_delivery`, `pickup`, `dine_in`, `home_delivery` con método).
    El spec fija `errorCode`, no la clase de excepción, como pide E.5.
  - ERR-19/20 en `dispatch-notes.service.ts:2026-2040`: mensajes ES
    con tipo/estado reales, gates NO relajados (state debe ser
    processing/pending_payment; direct_delivery sigue sin remisión).

## 2) Spec frontend pos-shipping-step — VERDE POR LECTURA (no re-corrido)

- `pos-shipping-step.component.spec.ts:271-286`: dirección declarada
  sin método → `missingShippingMethodReason()` contiene
  "antes de guardar o cobrar", aviso visible en DOM, `canConfirm()`
  falso, `buildShippingContext()` null, `execute()` no procesa.
- `:288-300`: pickup explícito → reason null, `canConfirm()` true,
  contexto `pickup` (mostrador/recogida no bloqueados).
- Fuente: `pos-shipping-step.component.ts:173-177`
  (`missingShippingMethodReason` computed) y `:642` (sección
  shipping-method en validación).
- No re-corrido por instrucción: E.1 ya lo dejó 24/24
  (`E.1-regression-shipping-step.txt` → `TOTAL: 24 SUCCESS`);
  el spec local tiene 24 bloques `it(`/`it.each`, consistente.

## 3) Evidencias E5-* commiteadas — 25/25 PRESENTES Y CUBREN

`git ls-files …/evidence/ | grep E5-` → 25 archivos, todos commiteados:

| Cobertura exigida | Evidencia |
|---|---|
| No-método 400 tipado | `E5-no-method.request/response.json` + `E5-address-no-method.request/response.json`: `error_code ORD_SHIP_REQUIRED_FOR_FLOW_001`, mensaje ES, `order_id/payment_id` null |
| Con-método 200 + remisión 201 + by-order | `E5-method.*` (orden #1119, pago #816), `E5-dispatch.*` (remisión #226 `REM2609230001`), `E5-byorder.response.json` (count 1, ids [226]), `E5-runtime-note.txt` (201 + 200) |
| Mostrador/pickup siguen OK | `E5-counter.*` (#1120), `E5-pickup.*` (#1121), ambos `success:true`; `E5-new-orders.txt` confirma #1120 direct_delivery/finished, #1121 pickup/finished |
| Huérfanas históricas cuantificadas | `E5-historic-direct-delivery.sql/txt` (count 0) |
| UI positiva/negativa + SQL remisión | `E5-ui-no-method.md/png` (bloqueo visible, Guardar deshabilitado, cero escrituras), `E5-ui-order-remision.md/sql/txt` + `E5-order-shipping-ui.png` + `E5-dispatch-note-ui.png` (badge, navegación a remisión #226, gap FK documentado) |

PNG: 3 archivos no vacíos (141K–231K).

## 4) SQL solo-lectura — DB-07 ABIERTO (esperado, pendiente F.2)

Detalle fila a fila en `E.5-SA1-db07-actual.txt` (misma carpeta).

- Huérfanas históricas re-corridas: **0** (igual que E5, sin regresión).
- DB-07 canónico (`home_delivery` nuevas sin FK o sin snapshot,
  `created_at > 2026-09-23 06:53:01`): **11** (7 cancelled + 4 vivas:
  #1119 processing, #1144 processing, #1158 shipped, #1167
  pending_payment). #1119 conserva snapshot pero `shipping_address_id=NULL`.
- `E5-new-orders.sql` re-corrido: #1119/#1120/#1121 idénticos a E5.
- Remisión #226: sigue `draft` de #1119 con dirección.

## Reporte

- Specs: backend **INFRA/OOM** (0 tests, heap 2048MB, verificado por
  lectura: gate + tests ERR-04 presentes y correctos); frontend
  **verde por lectura** (no re-corrido, 24/24 vigente en E.1).
- Cobertura evidencia: **25/25**, los 4 frentes cubiertos.
- DB-07: **abierto, pendiente F.2/ADR-05** (esperado). Sin regresión:
  huérfanas 0, órdenes E5 intactas, remisión válida.
- Archivos míos (únicos, prefijo `E.5-SA1-*`, sin commitear):
  `evidence/E.5-SA1-db07-actual.txt`, `evidence/E.5-SA1-verificacion.md`.
