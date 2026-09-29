# B.3 re-verificación — session_paid en vivo + snapshot (runner-2, 2026-09-24)

Runner: e2e-runner-2 · Tienda #10 (Roku) · mesero #241 (curl) + admin #163 (UI).
Motivo: B.3 está done (fox, `B3-live-paid.md`), pero hubo ediciones de peers en
`kitchen-fire`/mesas durante la ventana E2E → re-verificación anti-regresión con
fixture fresco. Resultado: TODO VERDE, sin regresión.

## Fixture (fresco, sin tocar ajenos)

- Mesa **#34** `QA B3 e2e-r2 20260924` (creada owner, `POST /store/tables` 201).
- Sesión **#134** / orden **#1224** (mesero, open 201) + Coca-Cola #302 ×1
  (`add-items` 201, $38.000, físico sin cocina).

## Recorrido

| Paso | HTTP observado |
|---|---|
| Abrir página sesión #134 (UI admin) | `GET .../134` 200 → "Cuenta abierta", **"Pago pendiente"** |
| Pagar desde otro cliente (curl owner, `POST /store/payments/pos` con `table_session_id=134`, sin items, efectivo $38.000) | **201** → pago `succeeded`, orden `finished` |
| Página abierta, SIN recargar | Muestra **"Pagada"** (mesa sigue Ocupada, sesión abierta) |
| Recargar página | Sigue **"Pagada"** (snapshot coherente) |

## Aserciones

- `table_sessions #134`: `paid_at` set, `closed_at` null tras el pago (cuenta
  pagada ≠ mesa cerrada, ADR-03).
- SSE snapshot (`GET .../stream?token=`, 21 sesiones): #134 presente con
  `paid_at` set; 15/21 pagadas. `/tmp/e2e-b3-sse.txt`.
- Floor-map: mesa #34 `occupied`, `active_session.paid_at` set, sesión #134.
- Whitelist intacta: `session_paid` en `table-sessions.controller.ts:64` y en la
  unión/discriminador del frontend (`admin-tables-sse.service.ts:113,519`).
- Consola UI: **0 excepciones JS** (1× 403 pre-existente subscriptions por rol +
  2 warnings framework NG0505/allowSignalWrites, ruido conocido).

## Evidencia

- Screenshot: `evidence/B3-live-paid-runner2.png` (sesión #134 "Pagada", $38.000).
- Crudos: `/tmp/e2e-b3-table.json`, `/tmp/e2e-b3-open.json`, `/tmp/e2e-b3-add.json`,
  `/tmp/e2e-b3-pay.json`, `/tmp/e2e-b3-sse.txt`.

## Incidente de entorno (mismo que E.1)

- Durante la recarga de comprobación, el navegador navegó solo a
  `/admin/pos?editOrder=1223` (orden `QA-E1-2b-P2` del peer e2e-2b, creada 02:06:42
  mientras yo verificaba). Se reintentó y la recarga mostró "Pagada" correctamente.
  5 navegaciones fantasma en total esta sesión, todas hacia artefactos vivos del
  peer (sesiones #132/#133, editOrder #1223). Hipótesis principal: un segundo runner
  E2E vivo (batch-1 truncado) comparte/mi servidor Playwright MCP o el mismo
  navegador — ver nota al boss en el reporte. Ninguna afectó el resultado B.3.

## Limpieza

- `POST .../134/close` → 201 (mesa #34 → `cleaning`, sin sesión activa).
- Orden #1224 `finished` (terminal, pago único, sin residuo).
