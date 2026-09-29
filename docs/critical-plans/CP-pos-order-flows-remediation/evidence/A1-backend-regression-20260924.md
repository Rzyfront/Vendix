# A.1 — Anti-regresión backend (CP-pos-order-flows-remediation)

- Fecha (UTC): 2026-09-24T01:02:24Z → 2026-09-24T01:02:56Z
- HEAD: `2431a11526b92cd0dd8817b9e355e00284d18648` (rama develop, checkout compartido)
- Rol: A.1 backend regression verifier (solo lectura + este archivo)

## 1. Verificación en código (lectura) — PASA

1. `order_id?: number` en `CreatePosPaymentDto`
   - `apps/backend/src/domains/store/payments/dto/create-pos-payment.dto.ts:266-271`
   - `@IsOptional() @IsInt() @Min(1) @Type(() => Number) order_id?: number` — presente.
2. Rama de vinculación scope-tienda en `createOrUpdateOrderFromPos`
   - `apps/backend/src/domains/store/payments/payments.service.ts:4429-4442`
   - `findFirst({ where: { id: dto.order_id, store_id: dtoStoreId } })`; si falta →
     `throw new VendixHttpException(ErrorCodes.ORD_FIND_001)` (mismo mensaje para
     faltante y cross-store: sin fuga de tenant). Claim atómico posterior con
     `updateMany({ where: { id, store_id, state } })` (:4451-4458).
3. `POS_DRAFT_DUPLICATE_ORDER_001` registrado y lanzado con `VendixHttpException`
   - Registro: `apps/backend/src/common/errors/error-codes.ts:1319-1323`
     (`httpStatus: 409`).
   - Lanzamientos: `payments.service.ts:4446-4449` (estado no cobrable / is_draft),
     `:4460-4463` (claim concurrente `count !== 1`), `:4473-4476` (pago
     `succeeded`/`captured` ya existente). Los tres con `VendixHttpException`.

## 2. Specs — NO EJECUTADOS (runner OOM, fallo de infra, no de contrato)

Comandos (secuenciales, un proceso, nada más en paralelo):

```
# desde apps/backend — el script NO existe ahí ("Missing script: buildcheck:test"),
# vive en la raíz; se corrió el equivalente acotado desde la raíz:
npm run buildcheck:test -- src/domains/store/payments/payments.service.spec.ts
npm run buildcheck:test -- src/domains/store/payments/payments.controller.spec.ts
```

Salida (ambos):

- `svc`: `▶ backend-tests FAIL (exit 1, 12s)` — `FATAL ERROR: Ineffective
  mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`
- `ctl`: `▶ backend-tests FAIL (exit 1, 18s)` — mismo OOM
- RAM libre estimada al correr: 6309 MB / 5981 MB; `TEST_MEM` default 2048 MB.
- Logs propios: `/tmp/a1-svc.log`, `/tmp/a1-ctl.log` (fuera del repo, revisables).

Conteo pass/fail: **0 pass / 0 fail ejecutados** — ningún test corrió; el proceso
jest murió por heap antes de reportar. No se reintentó (instrucción: reportar OOM
sin loop). Ningún test existente falla: no hay contrato roto que reportar, solo
bloqueo de ejecución por memoria/carga del checkout compartido.

## 3. Verificación por lectura de los specs (sustituto del run) — PASA

- `payments.service.spec.ts:1354-1441` (`describe createOrUpdateOrderFromPos — adopted order`):
  - `:1392` fija `caught.errorCode === ErrorCodes.ORD_FIND_001.code` + scope
    `{ id: 41, store_id: 1 }` (:1393-1395).
  - `:1408-1409` fijan `POS_DRAFT_DUPLICATE_ORDER_001.code` + status 409
    (paramétrico `succeeded`/`captured`); `:1424` y `:1438` fijan el mismo
    `errorCode` para estado no cobrable y claim stale. Tres de los cuatro casos
    combinan `toBeInstanceOf(VendixHttpException)` + `errorCode` exacto; el de
    estado no cobrable fija `errorCode` + mensaje `POS-41` + ausencia de
    escrituras. Cumple "fijan errorCode, no solo toBeInstanceOf".
- `payments.controller.spec.ts:103-112`: fija contrato DTO de `order_id`
  (`'41'` → `41` pasa whitelist; `'0'` viola `@Min(1)`). Sin `errorCode` porque
  es validación de DTO, no de servicio — esperado.

## 4. Conclusión

Contrato A.1 intacto por lectura (DTO + rama scope-tienda + error 409 tipado +
specs que fijan `errorCode`). Ejecución jest bloqueada por OOM del runner en el
checkout compartido; pendiente re-correr ambos specs cuando haya memoria libre.
