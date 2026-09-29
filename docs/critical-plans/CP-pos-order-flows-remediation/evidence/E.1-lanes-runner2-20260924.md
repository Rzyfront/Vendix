# E.1 — 4 carriles «Para llevar» = direct_delivery (runner-2, 2026-09-24)

Runner: e2e-runner-2 · Tienda #10 (Roku) · owner `owner@roku.vendix.com` (#162, curl)
+ admin `admin@roku-demo.vendix.local` (#163, UI detalle).
Cierra el ítem 10/10 de E.1 (loks dejó 9/10: "Falta E2E 4 carriles").

## Matriz de carriles (todas «llevar», expected `direct_delivery`)

| Carril | Orden | HTTP | delivery_type | Estado final | Notas |
|---|---|---|---|---|---|
| L1 POS directo | #1213 `POS-2026-0357` (Coca-Cola $38.000, sin `delivery_type` → default backend) | `POST /store/payments/pos` **201**, pago #864 | `direct_delivery` | `finished` | Default `payments.service.ts:4652` OK |
| L2 Borrador reabierto | #1220 `ORD2609240017` (draft → editor PUT qty 1→2 → pay) | editor **200**, `flow/pay` **200** | `direct_delivery` | `finished` | Misma orden, total $38.000→$76.000; 1 pago |
| L3 Detalle de orden | #1214 `ORD2609240013` (Hamburguesa $15.000, pay directo) | `POST .../1214/flow/pay` **200** | `direct_delivery` | `finished` | 1 pago; editor PUT sin `items` da 400 `SYS_VALIDATION_001` (requiere arreglo, documentado) |
| L4 Orden adoptada | #1215 `ORD2609240014` (`POST /store/payments/pos` con `order_id=1215`) | **201** | `direct_delivery` | `processing` + ticket cocina #124 `pending` | Misma orden (0 órdenes nuevas, guard A.1 OK). `processing` es eje fulfillment (plato prepared auto-disparado), NO eje delivery: el tipo es `direct_delivery`, no `pickup` |

Crudos: `/tmp/e2e-e1-l1.json`, `/tmp/e2e-e1-l2-create.json`, `/tmp/e2e-e1-l2-editor.json`,
`/tmp/e2e-e1-l2-pay.json`, `/tmp/e2e-e1-l3-create.json`, `/tmp/e2e-e1-l3-pay.json`,
`/tmp/e2e-e1-l4-create.json`, `/tmp/e2e-e1-l4.json`.

## DB-05 (0 llevar→pickup implícitas)

- Mis 4 carriles: **0 pickup** (4/4 `direct_delivery`).
- En la ventana aparecieron 4 `pickup` ajenas (#1216/#1217/#1221/#1222, alias
  `QA I2 C1/C2/C6/C6b`, producto "Test de servicio", todas `cancelled`): son
  fixtures explícitos del peer I.2 (mosk, flujo reembolso), NO llevar implícito.
  Legítimas bajo ADR-01 (pickup explícito) y fuera de mi scope; se reportan para
  que DB-05 se mida como "0 implícitas" (criterio SA3 de loks), no 0 absolutas.

## DB-10 (is_takeaway intacto)

- Antes: f=1042/t=32 · Después: f=1055/t=32 → **t invariante**; mis 4 ítems
  `is_takeaway=false`; el +13 en `f` son mis 4 + 9 de peers, todos `false`.
  Ningún flujo E.1 escribe `is_takeaway`.

## Evidencia visual

- `evidence/E.1-llevar-e2e/l2-detalle-finished.png`: detalle #1220 **Finalizada**,
  "Entrega directa en mostrador" (etiqueta E.1, distinta de "Recogida en tienda"),
  2× $38.000 = $76.000, pago Exitoso/Efectivo.
- Consola detalle: **0 excepciones JS** (1× 403 pre-existente
  `subscriptions/payment-methods` por rol + 2 warnings de framework NG0505/
  allowSignalWrites, ruido conocido).

## Desviación UI documentada (entorno, no código)

- El recorrido POS-shell (carrito → Para llevar → guardar borrador → reabrir en POS)
  quedó **bloqueado por entorno**: con un peer ejecutando sesiones de mesa en vivo
  en la misma tienda (#132/#133 de `QA G2 e2e-2b`), las páginas `/admin/pos` y
  `/admin/orders/:id` de mi navegador navegaban solas hacia la sesión del peer
  (observado 4 veces: pos→132 ×2, orders/1220→132, orders/1220→pos). `/admin/dashboard`
  estable 15 s (sin suscripciones live) → el follow viene de un feed live suscrito
  por esas páginas. Sin peers activos, la 3.ª carga del detalle fue estable y se
  capturó la evidencia.
- Cobertura sustituta honesta: L2 ejecuta el MISMO camino backend que el shell
  (draft → editor PUT → `flow/pay`, endpoint que usa el botón "Registrar Pago"
  según `store-orders.service.ts:516`; el modal de pago UI ya fue probado con clic
  real en E.4 `E4-clickpay-ui-20260923.md`). El reopen-UI-en-POS mecánico ya está
  probado en `A1-ui-full-recorrido-1153.md`; el delta E.1 (delivery_type) se aserta
  en DB en los 4 carriles.
- Login UI como mesero: problema menor — el form reenviaba credenciales mesero tras
  intentar cambiar de usuario (POST body con email anterior pese al fill); se usó
  login-vía-API + inyección de `vendix_auth_state` para admin #163 (flujo UI bajo
  prueba intacto). El mesero además sufre redirect POS→su-sesión-abierta (by design
  probable) agravado por la sesión #132 del peer abierta con el mismo usuario.

## Limpieza

- L1/L2/L3 `finished` (terminales, sin residuo). L4 `processing` con ticket #124
  `pending`: estado operativo normal (cocina prepara → entrega → finaliza); NO se
  cancela (una orden pagada entraría a flujo de reembolso I.2). Sin mesas usadas.
