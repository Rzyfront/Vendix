# C.3 — Cierre: mensajes accionables de cocina (ajuste §422)

- Fecha: 2026-09-24 · Ejecutor: toss · E2E: boss-e2e · Estado: done (10/10).
- Receta: `C.3-e2e-recipe-20260924.md`. Ajuste explícito §422 aplicado: donde
  la UI impide la acción por diseño (mejor UX que el toast), el criterio
  "toast real" se declara N/A-por-diseño y código+mensaje+HTTP quedan
  probados por curl.

## Veredictos E2E (boss)

- S1 lock (`C.3-lock-toast.md`): API 403 `KDS_STATION_LOCKED` ×2 (tickets
  #118/#121, mesero vs turno cocinero #46) + estado invariante. UI: toast
  inalcanzable — 3 capas (gate QUI-651, RBAC kds:read, Iniciar-turno DIS)
  bloquean al mesero antes que el servidor. N/A-por-diseño.
- Survey (`C.3-prevention-survey.md`, cocinero turno propio): ERR-08/422
  Entregar DIS con motivo; ERR-09/409 sin botón Entregar; ERR-10/409 y
  ERR-11/409 sin botones (solo sello). Todos N/A-por-diseño. Hueco:
  `in_preparation` sin datos (0 tickets).
- S2(b) (`C.3-409-toast.md`): API 409 `ORDER_ITEM_NOT_DELIVERABLE` sobre
  #1202/#1929 + `delivered_at=NULL` invariante. UI detalle: SIN botón
  entregar en línea no-lista (`canDeliver` exige ready). N/A steady-state;
  el mini-fix solo pinta en la raza ready→revertida (no fabricada: exige
  Start real con consumo+COGS).

## Ticket #5 (observación survey, resuelta por dueño)

- El motivo "incluye platos de mesa" en ORD2609240001 NO es bug FE:
  `kitchen_ticket_items→order_items #822` tiene `is_takeaway=false` y el
  card (`kds-ticket-card.component.ts:61-66`) exige `every(... === true)`.
  Lógica correcta; fixture inconsistente (orden takeaway, ítem no).
  Sin cambio de código. Calidad de seed/fixture, fuera de alcance C.3.

## Contratos

ERR-07/08/09/10/11/12/13, FB-35 [x].

## Deuda explícita

- S2-mesa: toast 409 en superficie mesa (requiere mesa libre o carrera
  ready→revertida). S2(b)-raza: toast mini-fix detalle solo en raza.
- FB-41 [ ]: `force-take` live sin probar (receta lo prohibía; open+A+
  entrega+B→403 sí probado). Requiere batch E2E con token owner.
- `in_preparation` sin datos en survey (happy path igual).
