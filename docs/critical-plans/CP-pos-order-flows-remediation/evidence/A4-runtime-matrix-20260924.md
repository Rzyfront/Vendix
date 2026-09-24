# A.4 — Matriz runtime + DB-16 + lectura frontend (2026-09-24 UTC)

Verificador: A.4 runtime matrix (mosk). Checkout compartido, rama `develop`, solo lectura + evidencia nueva.
Backend health 200. Cero 500 / cero `SYS_INTERNAL_001` en toda la corrida.

## Desvío documentado del login mandado

- Login mandado `owner@techsolutions.co` / `tech-solutions`: **200 OK**, pero TODAS las tiendas
  de la org 2 están `expired` (3, 4, 5). Cualquier escritura responde
  `403 SUBSCRIPTION_003` (`StoreOperationsGuard`) — ver `A4-mosk-techsolutions-403.json`.
  Las lecturas sí funcionan con ese token (GET orders/tables OK).
- Matriz ejecutada con `owner@roku.vendix.com` / `roku` (tienda 10, suscripción `active`),
  mismo patrón que `A4-local-api-verification.md` (tienda 10, producto 425).
  Nota: el rate-limit de login por IP/cuenta estaba caliente por otros agentes del checkout
  compartido; se esperó a que expirara la ventana (`rl:login:acct:*`, max 10/900s) y el login
  roku dio 200 al primer intento en ventana fresca.

## Matriz caso → resultado

| # | Caso | Esperado | Observado | Veredicto |
|---|------|----------|-----------|-----------|
| (a) | POST `/store/orders/1196/flow/cancel` `{"reason":"QA A.4 mosk"}` sobre borrador sin mesa | 200 + `state=cancelled` | 200 `"Order cancelled successfully"`, `data.state=cancelled`, DB `1196\|cancelled` | PASS |
| (b) | Borrador 1197 con mesa abierta (mesa QA 29, sesión 128) → POST `flow/cancel` | 409 `ORD_CANCEL_OPEN_TABLE_001` + `details.table_session_id` + cero escrituras | 409, `error_code=ORD_CANCEL_OPEN_TABLE_001`, `details.table_session_id=128`; orden sigue `draft`, sesión 128 abierta (`closed_at=null`), mesa `occupied` | PASS |
| (c) | GET borrador 1196 (pre-cancel) → `cancellation_policy` | `can_cancel=true` | `can_cancel=true`, `can_cancel_payment=false`, `reason_code=null` | PASS |
| (c2) | GET borrador 1197 con mesa abierta → `cancellation_policy` | `can_cancel=false` + `reason_code` | `can_cancel=false`, `reason_code=ORD_CANCEL_OPEN_TABLE_001` | PASS |
| (d) | DELETE `/store/orders/1198` sobre borrador poblado | 400 tipado, no 500 | 400 `ORD_VALIDATE_001` "Cannot delete an order with items…", orden intacta (`1198\|draft`) | PASS |
| DB-16 | Sesiones abiertas → orden `cancelled` | 0 filas | 0 filas (antes y después de la corrida) | PASS |
| RES | `stock_reservations` activas orden 1196 / 1197 | 0 antes/después | 0 / 0; pagos orden 1197: 0 | PASS |

## Integridad SQL ejecutada

```sql
-- DB-16 (0 filas antes y después)
SELECT s.id, s.closed_at, o.state FROM table_sessions s JOIN orders o ON o.id=s.order_id
WHERE s.closed_at IS NULL AND o.state='cancelled';

-- Reservas (0 en 1196 y 1197)
SELECT count(*) FROM stock_reservations
WHERE reserved_for_type='order' AND reserved_for_id IN (1196,1197) AND status='active';

-- Cero escrituras tras 409 (b): 1197|draft, sesión 128 abierta, mesa occupied, 0 pagos
SELECT o.id, o.state, s.id, s.closed_at FROM orders o
JOIN table_sessions s ON s.order_id=o.id WHERE o.id=1197;
```

Órdenes QA creadas (tienda 10): 1196 `cancelled`, 1197 `draft` (sesión 128 abierta, mesa 29),
1198 `draft` (delete-guard). Mesa QA 29 `QA A4 mosk mesa 20260924`.

## Lectura frontend (sin modificar)

Archivo `apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.ts`
(sucio por loks, solo leído):

- `case 'draft':` (línea 964) cae a `case 'created':` y empuja
  `{ id: 'cancel', label: 'Cancelar Orden', … }` en línea 972.
- `applyCancellationPolicy` (líneas 1142–1165): el filtro conserva `cancel` solo si
  `policy?.can_cancel === true` (línea 1148) → con `can_cancel=true` el botón NO se filtra;
  con `false` se reemplaza por alerta `cancellation-info` (líneas 1152–1163).
  Doble gate en `openCancelModal` (2714) y `submitCancellation` (2725).
- Hunk dirty de loks: UNA sola línea, 1103, cambio de label
  `'Confirmar recogida'` → `'Confirmar recogida en tienda'` en acción `deliver` (pickup)
  dentro del `case 'shipped'` pagado. NO toca el path de cancelación (972, 1148, 2714, 2725).

## Archivos de evidencia (nuevos, no pisan A4-* previos)

`A4-mosk-create-draft.{request.json,response.json,headers}`,
`A4-mosk-policy-draft.{response.json,headers}`,
`A4-mosk-cancel-draft.{request.json,response.json,headers}`,
`A4-mosk-create-table.{request.json,response.json,headers}`,
`A4-mosk-open-table.{request.json,response.json,headers}`,
`A4-mosk-policy-open-table.{response.json,headers}`,
`A4-mosk-cancel-open-table.{request.json,response.json,headers}`,
`A4-mosk-delete-draft.{response.json,headers}`,
`A4-mosk-techsolutions-403.json`. Sin tokens ni secretos (grep verificado).

## Bloqueadores

Ninguno para A.4. Hallazgo lateral (no bloquea): las 3 tiendas seed de `tech-solutions`
tienen suscripción `expired`, así que ese login mandado no puede ejecutar escrituras;
toda escritura QA debe ir contra tienda 10 (roku, `active`) o reactivar la suscripción seed.
