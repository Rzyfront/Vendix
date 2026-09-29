# B.2 — Verificación del corte a la proyección canónica (2026-09-24, fox)

B.2 resultó **verificación-only**: la auditoría s1 + spot-check propio confirman
que los 4 escritores y ambos confirmadores ya delegan en
`projectOrderPaymentToTableSession` (`table-sessions.service.ts:1761`).
Nada que cortar; todo que probar. HEAD marco: `db689e73a`→`5f6cf70f`
(checkout compartido; los specs citan su HEAD en `B.2-specs.txt`).

## Escritores: dónde delegan (código leído, no afirmado)

| Escritor | Sitio canónico | Emit post-commit | Prueba |
|---|---|---|---|
| 1. POS directo | `payments.service.ts:1384` (en tx) | `:2043` diferido; `closedSessionId=null` fijo (`:4004`) | spec 118/118 + E2/E4 live previo |
| 2. Split pay | `split-account-payment.service.ts:550` via `reconcilePayment` (`pay:399`) | `:565` post-tx | spec 27/27 + `B2-split-table-projection` live #1178 |
| 3. Webhook pasarela | delega en `orderFlow.confirmPayment` (`webhook-handler.service.ts:594,628`); **0** refs a `closeSession`/`table_session` en el archivo | vía confirm | `B2-confirm-order-webhook-replay` + T6 CAS |
| 4. `flow/pay` | `projectPaidOrderToTable` (`order-flow.service.ts:1616`, lazy `moduleRef` anti-ciclo) ×5 ramas (`:1342,:1428,:1546,:1729,:4715`) | post-commit; ERR-33 tipado (`:1630,:1734`) | live abajo + spec 146/148* |
| FB-53 confirm sesión | auto-llamada `:2725` post-commit, `shouldProject`-gated, ERR-33 capturado (`:2722`) y relanzado tipado (`:2799`) | tras SSE/caja | spec 77/77 (bloque B.2) + T5 |
| FB-12 confirm split | `confirm:448` → `reconcilePayment` → **misma `:550** (único call-site del archivo) | `:565` | spec `staff confirm delegates…` 27/27 |

\* order-flow 146/148: los 2 rojos son `cancelDeliveredOrderItem — reversa`
(restock/waste), idéntica firma 146/148 que el run C.1 de toss (`C.1-jest-orderflow.txt`),
asumidos en D.2. Cero rojos de proyección.

## Búsquedas (crudo: `B.2-escritores.txt`)

- `markSessionPaid|emitSessionPaid`: definiciones solo `:1823/:1906`, llamadas
  internas `:1786/:1793`. Único extra: variable local diferida
  `emitSessionPaidAfterCommit` (`payments.service.ts:903,1390,2043`) — plumbing
  sancionado del emit canónico, no segundo escritor. Cero matches en specs.
- `closeSession` en `webhook-handler.service.ts`: **0**. Único llamador prod de
  `closeSession`: acción staff explícita (`table-sessions.controller.ts:428`).
- Escrituras directas `table_sessions.*` fuera de `store/tables`+`ecommerce/tables`: **0**
  (`ecommerce-tables.service.ts:1791` escribe `payments.paid_at`, no sesión).

## Matriz live (tienda roku #10, `owner@roku.vendix.com`, backend health OK)

| # | Run | Esperado | Obtenido | Evidencia |
|---|---|---|---|---|
| 1 | `flow/pay` #1133 (draft $38k, sesión #115 abierta) | 200, paid+open, mesa occupied, conteo 15→16 | 200; `paid=t,closed=NULL`; mesa 23 `occupied`; **16** | `B.2-flowpay.json` |
| 2 | re-`flow/pay` #1133 | 409, `paid_at` estable, 1 pago | 409 state-machine; `paid_at` idéntico; 1 succeeded | `B.2-doublepay.json` |
| 3 | `flow/pay` #1189 (cocina pendiente) | 409 cocina, sin pago ni proyección | 409 `ORDER_HAS_PENDING_KITCHEN_ITEMS`; 0 pagos; `paid_at` NULL | crudo (sad-path bonus) |
| 4 | cerrar #114 + `flow/pay` #1132 | 409 ERR-33 tipado, pago persiste | 409 `POS_TABLE_SESSION_PROJECTION_FAILED_001`; pago #856 succeeded $38k | `B.2-err33.json` |
| 5 | POS close-out sesión pagada #115 | 409 ERR-05 tipado con ref, 1 pago | 409 `POS_TABLE_SESSION_ALREADY_CHARGED` (payment #855); 1 succeeded | `B.2-err05.json` |
| 6 | invariante global | 0 pagadas+abiertas con mesa no ocupada | **0** | SQL |

## Deudas y lecturas registradas

1. **Sesiones cerradas de más por el webhook no se reabren** (plan-mandado):
   sin backfill ni DDL; reabrir chocaría con el índice parcial si el mesero ya
   abrió otra. Decisión, no pendiente.
2. **Split proyecta en-tx** (`:550`) mientras el resto proyecta post-commit con
   aislamiento ERR-33: un throw de proyección en split revierte con el pago.
   No viola B.2 (el pago aún no está "cometido"), pero es la única asimetría;
   follow-up sugerido, fuera de alcance.
3. **ERR-05 "no alcanzarse"** = no se alcanza espuriamente: el happy (run 1) jamás
   lo emite; vive como guard correcto de doble cobro (run 5, tipado con ref).
4. **order-flow 146/148**: 2 rojos preexistentes D.2 (arriba), no bloquean B.2.

## Volteos B.2

FB-11/FB-12/FB-53, DB-17/DB-18, ERR-05/ERR-33 → `[x]` con esta evidencia.
FB-03/FB-04/DB-21 ya `[x]`. FB-12/FB-53 sin curl live propio (sin pending en dev
para escenificar; misma línea `:550`/`:2725` probada por spec+live afín).
