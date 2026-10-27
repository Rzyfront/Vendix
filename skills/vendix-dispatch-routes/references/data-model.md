# Modelo de datos de planillas

## `dispatch_routes`

| Columna | Notas |
|---|---|
| `route_number` | `VARCHAR(50)` único por tienda, `PLN{YYMMDD}{####}` generado atómicamente |
| `route_code` | Identificador externo (p. ej. "RI02") |
| `status` | `draft → dispatched → in_transit → closed`, o `voided` desde cualquier no terminal |
| `vehicle_id` | FK `vehicles` nullable (SET NULL) |
| `driver_user_id` / `external_driver_name` / `external_driver_id_number` | Interno, externo o ambos |
| `is_primary_driver_external` | Con ambos, indica quién conduce |
| `assistants` | JSONB `[{user_id?, external_name?, external_id_number?, role?}]` |
| `origin_location_id` | FK `inventory_locations` nullable |
| `planned_date` | NOT NULL |
| `dispatch_started_at` / `closed_at` / `voided_at` | Timestamps |
| `total_to_collect`, `total_collected`, `total_prepaid`, `total_changes`, `total_withholdings`, `total_credit` | DECIMAL(14,2) default 0 (`total_credit` siempre 0 en rutas nuevas) |
| `declared_cash` | Efectivo que trae el conductor (al cerrar) |
| `cash_variance` | `declared_cash - cash_collected` (+ sobra, − falta) |
| `settlement_cash_session_id`, `settlement_cash_user_id`, `cash_settled_at` | Caja contra la que se cerró |
| `currency` | 'COP' |

## `dispatch_route_stops`

| Columna | Notas |
|---|---|
| `route_id` | FK, CASCADE desde la planilla |
| `dispatch_note_id` | UNIQUE **parcial** `WHERE status != 'released'` (permite reasignar tras liberar) |
| `stop_sequence` | 1..N |
| `status` | `pending → in_progress → delivered | rejected`, o `released`. `partial` existe en el enum solo por filas históricas |
| `result` | `delivered`, `rejected`, `released` (`partial` solo lectura histórica) |
| `is_extra_route` | Parada fuera de lo planeado |
| `is_prepaid` | Derivado de `dispatch_note.invoice.payment_date IS NOT NULL`; excluido de `total_to_collect` y del cuadre |
| `collected_amount` | Efectivo cobrado |
| `anticipo_amount` | Reservado, hoy 0 |
| `change_amount` | Vueltas (refund `source_type='dispatch_route_change'`) |
| `withholding_amount` / `withholding_breakdown` | `{retefuente?, reteiva?, reteica?}`; la suma = `withholding_amount` |
| `credit_amount` | Siempre 0; enviarlo en el settle → 400 (`forbidNonWhitelisted`) |
| `payment_method` | `cash` (default), `transfer`, `card` |
| `settled_at` / `released_at` | Timestamps |

## Otros

- `dispatch_route_stop_history`: auditoría append-only (`start`, `settle`, `release`) con `from_status`, `to_status`, `reason`, `released_by`, `metadata` (montos).
- `vehicles`: por tienda, UNIQUE `(store_id, plate)`; si lo referencia una ruta no anulada, desactivar (`is_active=false`), no borrar.
- `dispatch_route_positions`: telemetría append-only, scope manual por `store_id` (sin getter scoped → `withoutScope()` + filtro explícito).
