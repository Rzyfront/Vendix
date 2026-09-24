# G.1 — Guard reformulado + elegibilidad (cierre live fox, 2026-09-24)

Base: `G1-edit-eligibility-code-20260923.md` (guard+util+126/126). Este paso
aporta los curl live y el barrido SQL que faltaban.

## Guard (código leído)

`assertTableOrderEditable` (`orders.service.ts:1570-1585`): pregunta sesión
ABIERTA primero (si existe, edita); solo bloquea con historial de mesa y
ninguna abierta (`ORD_EDIT_NOT_ALLOWED_001`); sin mesa, no-op. Lo usan
`updateOrderItems` y el editor (`:2025`). Specs: `orders.service.spec.ts`
107/107 (incl. cerrada-solo 409 con código fijo, PUT items pre-write).

## Elegibilidad pura

`canReassignOrderToTable` (`shared/order-table-reassignment-policy.util.ts`):
rechaza `cancelled`/`refunded` (ORDER_STATE + `details.state`), sin historial
(TABLE_SESSION_NOT_FOUND 404 reutilizado), ya abierta (ALREADY_OPEN), pago
liquidado / split activo / factura numerada (NOT_ELIGIBLE + `details.reason`).
Códigos 409 en `error-codes.ts:1371-1379`. Spec 19/19 con `errorCode` fijo (×6).

## Live (tienda roku #10)

| Run | Esperado | Obtenido | Evidencia |
|---|---|---|---|
| PUT items #1184 (draft, solo cerrada) | 409 `ORD_EDIT_NOT_ALLOWED_001` | 409, código fijo, sin details (guard de mesa, no de estado) | `G1-items-sesion-cerrada.json` |
| PUT items #1189 (draft, abierta #125) | 200 | 200, ítem agregado | `G1-items-sesion-abierta.json` |
| Barrido multi-sesión | SQL guardado | 1 orden (#1192: 2 cerradas, 0 abiertas) | `G1-sesiones-por-orden.txt` |

## Nota de secuencia (cerrada+abierta live → G.2)

Ninguna orden en dev tiene cerrada+abierta (solo #1192 con 2 cerradas) y
pre-G.2 no existe API que cree ese estado (`openSession` siempre orden nueva).
El propio G1 lo difiere: "G.2 debe aportar curl/SQL de cerrada+nueva abierta".
G.1 cierra con matriz spec + singles live; G.2 (reasignar #1192) prueba
cerrada+abierta live (PUT + add-items 200).
