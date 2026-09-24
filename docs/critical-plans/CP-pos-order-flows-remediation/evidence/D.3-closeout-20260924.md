# D.3 — Cierre: vocabulario unificado + remake single-fire

- Fecha: 2026-09-24 · Ejecutor: toss · Estado: done (10/10).
- Live: re-probe boss `D.3-remake.json` — resend remake #1188 [1912,1913]
  → 201 ticket#126 (single-fire) + replay → 422
  `KITCHEN_FIRE_NOT_RESENDABLE`. Cierra ítem 3, FB-30/40, ERR-17, F-003/F-008.

## Implementado

- Remake single-fire (`kitchen-fire.service.ts`, +89/−12): en
  `remake_dish` post-cancelación TODOS los items (reuso+merma) van por UN
  solo fire canónico (antes: el reuso reimprimía SIN consumir = plato
  gratis + stock inflado). Guard anti-replay en-tx: rechaza si ya existe
  ticket nacido tras la cancelación (por tiempo, no por estado: un
  `ready`/`in_preparation` original sobrevive a la cancelación).
  `lost_command` intacto bit a bit.
- F-008 (bug propio, fixed): el guard leía `orders.cancelled_at`
  (columna inexistente → 500 en TODO resend); ahora deriva el máximo
  `cancelled_at` de los ítems cargados + fallback cerrado. Specs 44/44.
- FB-26 (subagente D3-fe): `orders.service.cancelOrderItem` envía
  `{reason, cancellation_type?}` (+19/−6, watch OK); cadena modal→body
  verificada punta a punta (`D.3-fe-body.md`).

## Verificado (curl + SQL + specs, sin E2E-login)

- FB-25: `PATCH cancel {after_fire_reused}` → 200 + tipo persistido
  (`D.3-cancel-reuso.json`, orden #1206/ítem #1933).
- Inválido: `cancellation_type:inventado` → 400 `SYS_VALIDATION_001`
  tipado (`D.3-valor-invalido.json`). Desvío doc: el pipe global da 400,
  no 422 (igual que D.2; decisión formal en F-007/D.4).
- Vocabulario: DISTINCT = 5 valores exactos (3 canónicos + 2 históricos
  1060 intactos, `D.3-vocabulario.txt`); maxlen 17 ≤ 20 (`D.3-longitud.txt`).
- Censo: 5 posiciones de escritura, todas canónicas
  (`D.3-censo-escritores.txt`): 2802 resolvedType, 3101/3167 destino,
  3922 waste literal, 3941→3988 disposition.
- FB-29: 0 llamadores nuevos del DELETE deprecado (`D.3-fb29-grep.txt`).
- FB-28 (estructural): mesa delega al MISMO seam compartido
  (`table-sessions.service.ts:1154` → `cancelOrderItem` con el MISMO DTO);
  divergencia imposible por construcción. Live mesa bloqueado (0 mesas
  libres, G.2 ocupa #27/#28) — ruling boss pendiente.
- Specs: kitchen-fire 44/44 (4 remake failing-first del checkpoint +
  F-008, 0 regresiones); order-flow 149+3 (D.4 tip) salvo 14 rojos AJENOS
  (ADR-12 refund en vuelo de otro peer, reportado).
- Logs: 0 errores atribuibles a D.3.

## Rulings boss (log `b4814c7a5`)

1. Re-probe remake ✅ ítem 3 (`D.3-remake.json`).
2. FB-28→D.4 mesa-live (D.3 cierra estructural).
3. F-007 registry→400 en D.4 (tubería global intacta).

## Contratos

FB-25/26/29/30/40, DB-09, ERR-17 [x]. F-003/F-008 fixed. FB-28→D.4.
