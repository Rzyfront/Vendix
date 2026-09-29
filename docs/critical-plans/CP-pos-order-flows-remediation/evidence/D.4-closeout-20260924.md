# D.4 — Cierre: modal destino + recálculo propina (11/12, ítem 9→boss)

- Fecha: 2026-09-24 · Ejecutor: toss · Estado: done 11/12.
- Código: backend `rederivePercentageTip` + modal compartido
  `item-cancellation-modal/` (detalle con preview, mesa con nota) +
  mapping cobrada→reembolso. Specs D.4 3/3; FE watch OK + spot-check
  aritmético espejo.

## Live (mesero #241, tienda #10, fixtures propios, todo limpio)

- Tip % (`D.4-tip-live.md`): #1230 10% 3000→1500 sobre subtotal vivo,
  grand 16500 = 15000+0+0+1500−0. Tip fija: #1231 2000 intacta,
  grand 17000. Ítems 5/6/7 ✅. F-001 fixed.
- FB-28 (`D.4-FB28-mesa-live.md`): mesa #1961 + detalle #1962 con
  `before_fire` → 200/200, SELECT idéntico. Sesión #137 cerrada, mesa
  #35→available. Ítem 4 + FB-28 ✅.
- Cobrada (`D.4-cobrada-409.json`): #1208/#1936 → 409
  `TABLE_SESSION_ITEM_NOT_REMOVABLE`, intactos; FE deriva a reembolso
  (bloqueo `cancellationBlockedByPayment` + mapping ERR-15). Ítem 8 ✅.
- F-007: ERR-42→400 real (pipe global intacto). Ítem F-007 ✅.

## Contratos

FB-25/26/27/28, DB-02/44, ERR-15/42 [x]. F-001/F-007 fixed.

## Deuda explícita (boss backlog runner-4)

- Ítem 9 [ ]: E2E visual modal (foco/Escape/shell) en detalle + mesa.
  Código listo y auditado; aviso "código listo" enviado.
- Preview-mesa UI: el modal compartido muestra nota (la sesión no
  proyecta impuesto/propina). Ruling boss pendiente (backlog).
- Observación: mesa-cancel no deja audit (detalle sí, #56027). Fuera
  de contratos D.4 (DB-44=cancelDelivered); posible hallazgo nuevo.
- 14 specs `cancelOrder` rojos: mocks rotos por rewrite ADR-12 mosk
  (`findMany` of undefined), pre-existentes en HEAD; `cancelOrder`
  nunca llama `rederivePercentageTip`. Dueño: specs-f2 mosk.
