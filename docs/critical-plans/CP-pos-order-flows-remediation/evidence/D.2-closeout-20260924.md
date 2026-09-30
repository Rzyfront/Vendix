# D.2 — Cierre: reversa BOM reuse + merma DR5295/CR6135

- Fecha: 2026-09-24 · Ejecutor: toss · Base: `develop` + C.1/C.2 cerrados.
- Fixture propio tienda #10: plato #316 (1 hoja #315, stock 9400, capas 8400).
  Cuentas: mesero (orden/fire/deliver), cocinero (start/ready),
  `secprobe.cp@roku.test` cashier documentado (cancel-delivered).

## Live (curl + SQL, sin E2E-login)

- TEST A reuse (`D.2-reuso.json` 200): orden #1201/ítem #1928, fuego −320
  (COGS 1600), deliver, cancel-delivered restock → hoja vuelve 9400
  (`D.2-plato-sin-cambio.txt`), plato 316 oh 0→0, 0 movimientos prepared
  (`D.2-sin-restock-de-plato.txt`), asiento reuse DR1435/CR6135 1600
  construido (`D.2-reuse-skipped-entry.txt`, fila skip #108).
- TEST B waste (`D.2-merma.json` 200): ítem #1930 → stock 9080→9080
  (cero movimientos), asiento DR5295/CR6135 1600 cuadrado
  (`D.2-asiento-5295.txt`), auditoría `order_item.prepared_disposition`.
- TEST C default (`D.2-default-waste.json` 200): `PATCH cancel` SIN tipo
  sobre línea disparada → `cancellation_type=after_fire_waste`.
- TEST D idempotencia: replay waste → 200, 1 sola disposición, stock inmóvil.
- Destino inválido (`D.2-destino-invalido.json`): 400 `SYS_VALIDATION_001`
  tipado (no 422: el pipe global valida el enum en borde; sin mutación).
- Logs backend: 0 errores atribuibles a #1201/#1203/#1204 (ruido ambiente ajeno).

## Desviaciones documentadas (no adivinadas)

1. `SELECT ... WHERE order_item_id GROUP BY` NUNCA da 0: la devolución va SIN
   `order_item_id` por diseño D.1 (FK Restrict). Neto 0 probado por movimientos
   (consumo −320 + devolución +320, `D.2-suma-por-hoja.txt`) + round-trip stock.
2. Asientos NO se insertan en dev: área `accounting` inactiva org 6
   (`SKIPPED_AREA_INACTIVE`, fila skip registrada). La CONSTRUCCIÓN del
   asiento (cuentas DR5295/CR6135/DR1435, balanceo) queda probada en vivo
   vía payload del skip-row + specs; el INSERT es gate de entorno activo.
   No se activó el área (mutaría conducta para los 4 ejecutores).
3. 400 vs 422: el pipe global devuelve 400 en enums DTO. Propiedad exigida
   (rechazo tipado, no 500, sin mutación) se cumple; aplica igual a D.3.

## Specs

- `order-flow.service.spec`: 149/149. 2 rojos pre-D.2 actualizados al
  vocabulario canónico (`after_fire_reused/waste`, contrato D.2+D.3, no
  debilitamiento) + 1 spec nuevo default-waste (ítem 6). Bloque D.2 13/13.
- Auto-entries: 29/29 (veredicto `D.2-acct-verdict.md`, subagente D2-acct):
  mapeos 5295/1435/6135 alineados en 4 fuentes; idempotencia OK secuencial,
  riesgo concurrente BAJO preexistente (sin unique, patrón del repo).

## Contratos

DB-28/29/30/31/32 [x]; DB-44 [x] (A.3, +filas D.2); FB-28 queda para D.3
(comparación mesa-vs-detalle + enum). Ítem 9 (snapshot prod) es GATE DE
RELEASE: pendiente al merge a main, fuera del alcance develop.
