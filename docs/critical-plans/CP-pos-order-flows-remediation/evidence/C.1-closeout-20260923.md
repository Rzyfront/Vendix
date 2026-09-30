# C.1 — Cierre formal: barrido global DB-08/DB-23 + verificación

- Fecha: 2026-09-23 · Ejecutor: toss · Base: `2431a1152` · ADR-06: accepted (2026-09-23).
- El carril funcional E2E (dos roles, ticket mixto, SQL una sola línea) ya estaba
  verificado en `C1-mixed-ticket-other-cook-20260923.md`. Este cierre agrega el
  barrido global pendiente y re-verifica código + specs.

## Barridos globales (solo lectura, DB dev local)

- DB-08 (`delivered_at > updated_at`): global = 18, TODOS legacy Jun–Jul 2026
  (detalle en `C.1-db08-legacy-list.txt`, sin backfill); postcut ≥2026-09-23 = 0.
  Salida: `C.1-db08-global.txt`.
- DB-23 (auditoría latest-ticket, query `C2-latest-ticket-audit-20260923.sql`):
  1 mismatch legacy #1692 (orden #1008, `delivered_at` 2026-09-01, pre-cut);
  `postcut_mismatch` = 0. Salida: `C.1-db23-sweep.txt`.

## Código + specs (subagente C1-verify, sin cambios a código)

- `grep kitchenService.markDelivered` en `table-session-page.component.ts`: 0 hits;
  KDS conserva `markDelivered` (definición + llamada tablero). Destino único
  `deliverTableSessionItem` confirmado.
- `table-sessions.service.spec.ts`: 77/77 (`C.1-jest-shim.txt`).
- `order-flow.service.spec.ts`: 146/148 (`C.1-jest-orderflow.txt`). Los 2 rojos son
  `cancelDeliveredOrderItem — reversa` (restock/waste), PREEXISTENTES en la base
  `2431a1152` sin cambios de C.1: pertenecen al área D.2 (semántica
  cancel-delivered), NO al seam de entrega C.1. No se tocan aquí; D.2 los asume.
  Toda la cobertura de entrega (`deliverOrderItem`, compuerta prepared/ready,
  idempotencia) está verde.

## Contratos cerrados por C.1

FB-31, FB-32, FB-33, DB-08, DB-23, DB-24, ERR-08. Quedan para C.3: ERR-07, ERR-12
(toasts Playwright).
