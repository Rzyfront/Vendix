# C.2 — Cierre: revert live limpia `delivered_at` (F-002 fixed)

- Fecha: 2026-09-24 · Ejecutor: toss · Base: `2431a1152` + `8aa3db2ac` (C.1) · ADR-06 accepted.
- Fixture propio tienda #10, cero contención: orden mostrador #1193 / ítem #1920
  (producto #333, sin receta, `track_inventory=false`) → fire → ticket #115
  (Cocina #1 por defecto, COGS 0, 0 movimientos; sin turno abierto, caso 1).

## Revert en vivo (contrato FB-34, finding F-002)

- `POST tickets/115/start` → 422 `KITCHEN_TICKET_NO_RECIPE` (sin receta, by design);
  `POST .../ready` directo → 201.
- `POST tickets/115/delivered` (cocina) → 422 takeaway-only con mensaje C.3
  (`C.2-kitchen-delivered-422.json`): la línea es de mesa. Por eso la entrega se
  hizo por el seam de orden (único seam de mesa post-C.1): `PATCH
  /orders/1193/flow/items/1920/deliver` → 200 (`C.2-item-delivered.json`).
  Ticket #115 → `delivered` al completarse su única línea.
- Pre-revert SQL: ticket `delivered`, kti `delivered`, `delivered_at` seteado.
- `POST tickets/115/revert` → 201 (`C.2-ticket-revert.json`), ticket → `ready`.
- Post-revert SQL (`C.2-revert-sql.txt`): ticket `ready`, kti `ready`,
  `order_items.delivered_at=NULL`. F-002 queda fixed en vivo.
- Auditoría vigente↔línea post-revert (`C.2-audit-post-revert.txt`): solo legado
  #1692 (2026-09-01), `postcut_mismatch` 0; DB-08 postcut 0.
- Limpieza: `flow/cancel` con `kitchenDisposition:waste` → 200 (sin disposición
  dio el 422 tipado de D.1, verificado de paso). Sin turno/producto/mesa tocados.

## Specs (subagente C2-verify, sin cambios a código)

- `kitchen-fire.service.spec`: 40/44 (`C.2-jest-kitchen.txt`). Bloque C.2
  «revertTicket delivery stamp invariant» 3/3 + puente/takeaway 6/6 verdes.
  Los 4 rojos están en «remake consumption after D2 reuse» (resendOrderItems):
  alcance D.2/D.3, preexistentes en base, NO se tocan (asumidos en D.2/D.3).
- `order-flow.service.spec`: 146/148 (`C.2-jest-orderflow.txt`). Bloques C.2
  verdes (sync 8/8, bridge reverse 5/5). Los 2 rojos son los conocidos de
  `cancelDeliveredOrderItem` (área D.2, aprobados para asumir en D.2).
- Censo (`C.2-censo-escritores.txt`): 9 escrituras reales, todas en los 3
  carriles (orden/cocina/despacho); 0 cuarto escritor.

## Baseline histórica (sin backfill)

- DB-08: 18 legacy Jun–Jul 2026 (`C.1-db08-legacy-list.txt`), 0 postcut.
- DB-23: 1 legado #1692 (`C.1-db23-sweep.txt` + `C.2-audit-post-revert.txt`).
