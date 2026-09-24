# B.3 — Decisión `paid_at` legacy: sin backfill (2026-09-24, fox)

## Recuento (dev, `B3-legacy-paid-at.txt` + SQL 2026-09-24)

Sesiones con `paid_at IS NULL` y pago `succeeded/captured` en la orden: **33**.

| Clase | n | Detalle | Acción |
|---|---|---|---|
| Legacy cerradas (fichero B3) | 13 | ids 23..73, órdenes `finished`, todas `closed_at` no nulo | ninguna |
| Legacy cerradas (otras) | 18 | ids 5..88, `finished`/`shipped`/`draft`, todas cerradas | ninguna |
| Stale-abiertas pre-corte | 2 | sesiones #89/#96 (órdenes #1058/#1084), pagos del **2026-09-16/19**, anteriores a la canónica (226c25ee6, 2026-09-22) | ninguna (higiene dev, no bug) |
| Test B.2 fox | 1 | sesión #114 (orden #1132): cerrada a propósito, cobrada → ERR-33 por diseño, `paid_at` NULL correcto | ninguna |

## Decisión: no backfill

1. El invariante DB-17 rige sesiones **nuevas** ("nuevas sesiones pagadas:
   `paid_at` no nulo sin cerrar"): 0 violaciones post-corte (B.2 live #1133,
   #1059 + specs). Verificado: `closed_at IS NULL AND paid_at IS NULL AND
   EXISTS pago` post-corte = **0**.
2. Las 31 cerradas no alimentan ningún consumidor vivo (mesa ya cicló);
   rellenarlas no cambia ninguna pantalla.
3. Coherente con B.2 (sesiones cerradas de más por el webhook no se reabren,
   sin backfill) y con el plan (sin DDL ni scripts retroactivos).
4. Las 2 stale-abiertas (#89/#96) se dejan intactas: mutar datos dev
   compartidos por estética es peor que documentarlas. Si alguien las usa,
   siguen el camino ERR-33 al cobrar (diseñado).

DB-17 `[x]` (B.2) se sostiene. Pendiente de ratificación boss si el dueño
quisiera backfill idempotente (rejected por defecto).
