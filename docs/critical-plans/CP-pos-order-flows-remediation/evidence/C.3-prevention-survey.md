# C.3 Survey — prevención UI por estado (cocinero #242, solo lectura, 2026-09-24)

Runner: boss-e2e · `/admin/restaurant-ops/kds`, estación Cocina #1 seleccionada, turno propio #46 abierto
(`canManageTickets=true`). Cero clics en tickets ajenos; único modal abierto: detalle de ticket propio #121
(lectura). Consola: 0 excepciones JS; 5× 403 de recurso por rol (subscriptions ×3, weekly-report, pqr —
mismo ruido pre-existente que mesero, menos `/store/kds` porque cocina sí tiene `kds:read`).

## Tabla por estado (tablero + modal detalle propio)

| Estado (tickets vistos) | Botones renderizados | Código implicado | ¿Toast real alcanzable? |
|---|---|---|---|
| `pending` sin receta (#118 propio) | Iniciar **DIS** ("Falta una receta activa en uno o más platos"), Cancelar **DIS** ("Solo un encargado puede cancelar tickets de cocina") | — | n/a (no hay acción disparable) |
| `pending` con receta (#121 propio; modal detalle igual) | Iniciar **EN**, Cancelar **DIS** (encargado). **No existe botón Entregar/Listo** ni en tarjeta ni en modal | ERR-09 `KITCHEN_TICKET_NOT_READY` 409 | **N/A-por-diseño (ausencia)**: no hay control que dispare la entrega prematura |
| `ready` takeaway (#5 ORD2609240001, ajeno) | Entregar **DIS** ("Este ticket incluye platos de mesa: entrégalos por ítem desde la mesa. Cocina solo entrega tickets 100% para llevar."), Cancelar **DIS** (encargado) | ERR-08 `KITCHEN_TICKET_NOT_TAKEAWAY` 422 | **N/A-por-diseño (deshabilitado con motivo)** |
| `ready` mesa/mixto (#8 QA G2, visto en sesión mesero sin filtro estación) | Entregar **DIS**, mismo motivo takeaway-only | ERR-08 422 | **N/A-por-diseño (deshabilitado con motivo)** |
| `delivered` (#7/#9, ajenos) | **Sin botones de acción** (solo sello "Entregado") | ERR-10 `KITCHEN_TICKET_ALREADY_DELIVERED` 409 | **N/A-por-diseño (ausencia)** |
| `cancelled` (6 tickets, ajenos) | **Sin botones de acción** (solo sello "Cancelado" + nav "Crear receta") | ERR-11 `KITCHEN_TICKET_ALREADY_CANCELLED` 409 | **N/A-por-diseño (ausencia)** |
| `in_preparation` | **0 tickets** en la ventana — sin datos | — | Hueco: nadie puede tabularlo hoy (el ready desde aquí es happy path de todos modos) |

## Prevenciones transversales (ambos roles)

- **Cancelar**: DIS para cocinero y mesero ("Solo un encargado puede cancelar tickets de cocina").
  Los toasts de cancelación solo serían alcanzables por rol encargado+ (sin usuario seed E2E).
- **Mesero**: además del gate QUI-651 (ver `C.3-lock-toast.md`), ve el mismo set deshabilitado;
  la única diferencia es que Iniciar-EN-en-cocinero en mesero muere en el diálogo "Sin turno abierto".

## OBSERVACIÓN para dueño C.3 (no veredicto)

El ticket #5/ORD2609240001 es de orden **mostrador takeaway** (`direct_delivery`, badge PARA LLEVAR)
pero su Entregar muestra el motivo **"incluye platos de mesa"**. O la detección takeaway-only del
frontend miscategoriza este ticket, o el ticket arrastra marca de mesa de su fixture (C.2, toss).
Si es lo primero, un ticket 100% para llevar nunca podría entregarse desde cocina (seam C.1 diría
que eso está bien — entregar desde orden/mesa — pero el motivo mostrado confundiría). Requiere
mirada del dueño; el survey solo registra el hecho.

## Propuesta (decide dueño/orquestador)

Declarar "toast real" **N/A-por-diseño** para ERR-08/09/10/11: la UI impide cada acción (ausencia o
disabled-con-motivo, mejor UX que el toast) y código+mensaje+HTTP quedan probados por curl
(`C3-station-lock-and-codes-20260923.md`, `C3-http-rejection.md`). Excepción: `in_preparation` sin
datos — aceptar hueco o fabricar ticket (requiere Start real con consumo de inventario).
