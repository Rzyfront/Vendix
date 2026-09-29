# F.3 — línea base SQL antes del recorrido nuevo (dev, 2026-09-23)

Consultas **solo lectura** en `vendix_db`; ninguna fila modificada.

| Consulta | Resultado |
| --- | ---: |
| `dispatch_notes` con `customer_id IS NULL` y `customer_name` vacío | 41 |
| Remisiones cuyo `orders.customer_alias IS NOT NULL` y nombre copiado vacío | 2 |
| Remisiones de orden con alias y `customer_address IS NULL` (DB-35) | 0 |
| Paradas cuya remisión tiene `customer_address IS NULL` (DB-36 global) | 57 |

Estas 57 paradas y 2 remisiones con alias sin nombre son **legado**; F.3 no reescribe documentos ya emitidos. DB-36 se verificará sobre el nuevo recorrido de alias/ruta y sobre filas posteriores al corte, no exigiendo cero global sin backfill. Faltan recorrido HTTP/UI, PDF y comprobación de las filas nuevas.
