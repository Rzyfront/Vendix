# KDS — Kitchen Display System (restaurant-ops)

Tablero de cocina en tiempo real (SSE) y gestión de estaciones/turnos de QUI-651.

- **Board:** `pages/kds-board-page/` — tablero de 5 columnas (pendientes, en
  preparación, listos, entregados, cancelados) alimentado por SSE + snapshot.
- **Configuración:** `pages/kds-manage-page/` — estaciones de preparación,
  historial de turnos, detalle de movimientos y resumen de consumo.
- **Servicios:** `services/` — `KdsSseService`, `KitchenTicketsService`,
  `KdsStationsService` (estaciones + turnos + consumo).
- **Tipos:** `interfaces/kds-station.interface.ts`, `kitchen-ticket.interface.ts`,
  `fire-preview.interface.ts`.

## Invariante de producto — ADR-10: el KDS nunca muestra dinero

> **Regla (usuario, 2026-08-29):** "el KDS nunca muestra dinero (ADR-10) — en
> cocina solo cantidades de insumos; no reintroducir precios/costos/gastos/ganancias
> en esta superficie por ningún PR."

Consecuencias que ya están aplicadas (C.6):

- El resumen de consumo por turno y el historial de movimientos son **solo
  cantidades por insumo**. No transportan `total_cost`/`unit_cost` ni ningún otro
  campo monetario.
- El payload backend de `consumption-summary` / `consumption-history` **no envía**
  dinero (tampoco el snapshot `summary` de los turnos cerrados servido por
  `GET /store/kds-sessions`).
- Las superficies de cocina (board + detalle de turno) nunca pintan una cifra en
  pesos. El costo de insumos por turno se retiró **sin sustituto** de esta
  superficie: la regla dura del usuario es más fuerte que el interés de un
  supervisor de ver costos desde cocina. Donde sí puede consultarse es en la capa
  de analítica/reportes (bajo un permiso que cocina no tiene).

**No reintroducir** `total_cost`/`unit_cost` (ni precios, costos, márgenes,
gastos o ganancias) en el render ni en el payload de ninguna superficie KDS. Si
un PR futuro agrega dinero al KDS, está violando ADR-10.
