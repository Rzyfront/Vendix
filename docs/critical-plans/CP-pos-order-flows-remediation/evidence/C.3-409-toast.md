# C.3 S2(b) — 409 plato-no-listo ERR-12 en detalle-orden: veredicto UI + prueba API (2026-09-24)

Runner: boss-e2e · Tienda #10 · mesero #241 · orden propia #1202 (`ORD2609240007`), ítem #1929
(Hamburguesa #333 ×1), ticket #118 `pending`. Ruta real del detalle: **`/admin/orders/:id`**
(la receta no daba ruta; `/admin/orders/sales/:id` renderiza shell vacío — deep-link muerto).

## UI (Playwright) — CLIC IMPOSIBLE POR DISEÑO ❌→N/A

Recorrido real: lista `/admin/orders/sales` → clic fila ORD2609240007 → detalle `/admin/orders/1202`.
Botones a nivel de línea sobre el plato pendiente disparado:

1. Badge "Cocina: Pendiente" (habilitado) → navega "Ver ticket #118 en el KDS" (no muta).
2. "Reenviar a cocina" **DIS** ("Solo un encargado puede reenviar platos a cocina").
3. "Cancelar" habilitado.
4. **No existe botón Entregar/Marcar entregado** sobre la línea no-lista.

Causa en código: `canDeliver` (`order-details-page.component.ts:3991`) exige
`kitchenStateFor(item).status === 'ready'` para ítems disparados; con ticket `pending` retorna false
y el template no renderiza el control. `deliverItem` además re-chequea `canDeliver` antes de disparar
(línea 4020). El mini-fix C.3 (`parseApiError(err).userMessage`, línea 4035-4039, verificado presente)
solo puede pintar su toast en la **carrera** ready→clic→revertida — la misma carrera que la receta
ya declara deuda ("requiere mesa libre o carrera ready→revertida"). No se fabricó la carrera:
exigiría Start real (consumo de inventario + COGS) + ready + revert concurrente, fuera de receta.

Consola en detalle: **0 excepciones JS**; 9 errores = 8× 403 de recurso por rol waiter (subscriptions ×3,
weekly-report, pqr, dian emission-status, dispatch-notes/by-order, payment-methods) + 1 log de servicio
derivado del 403 payment-methods. Ruido pre-existente, no regresión.

## API — PROBADO ✅ (misma línea)

`PATCH /store/orders/1202/flow/items/1929/deliver` (mesero) → **HTTP 409**
`ORDER_ITEM_NOT_DELIVERABLE` — "El plato "Hamburguesa Artesanal" todavía no está listo
(estado: pending). Espera a que cocina lo marque como listo en el KDS antes de entregarlo."
Post-sonda: `delivered_at=NULL`, orden sigue `created` (cero escritura parcial).
Crudo: `/tmp/c3-s2b-deliver.json`.

## Evidencia

- Screenshot: `evidence/C.3-409-detail.png` — detalle con línea pendiente y **ausencia** del botón entregar.
- Limpieza: con S1 (turno #46 + órdenes #1202/#1205).

## Deuda explícita (heredada + nueva)

- S2-mesa (receta): toast 409 en superficie mesa sigue pendiente (carrera/canje ready→revertida).
- S2(b)-raza: el toast del mini-fix en detalle solo es observable en la carrera ready→revertida;
  steady-state es N/A-por-diseño (botón ausente). Propuesta: declarar ERR-12/UI N/A-por-diseño con
  prueba API, o abrir step de carrera (requiere mutación real de inventario — decisión dueño).
