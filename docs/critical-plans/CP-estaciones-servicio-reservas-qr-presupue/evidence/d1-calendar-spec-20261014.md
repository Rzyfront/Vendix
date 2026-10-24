# D.1 — Spec de calendario de estaciones de servicio

- **Worktree:** `/tmp/Vendix-service-stations-qr` (`feature/service-stations-reservas-qr-budget`)
- **Command:** `NODE_OPTIONS="--max-old-space-size=4096" npm run test -w apps/backend -- src/domains/store/service-stations/service-station-calendar.service.spec.ts`
- **Result:** PASS (18.422 s). 4 passed, 4 total.
- **Coverage:**
  - `replaces weekly intervals atomically and stores wall-clock values in TIME columns`: PASS
  - `rejects overlapping windows before writing`: PASS
  - `does not delete an exception from another store or station`: PASS
  - `requires exception timestamps with explicit UTC Z and an increasing interval`: PASS
- **Fixes applied:**
  - Excepción `STATION_004` verificada contra propiedad tipada `errorCode`.
  - Validación estricta de sufijo UTC `Z` en `createException` para asegurar fechas conformes a `vendix-date-timezone`.
- **Cleanup:** Exit code 0, sin procesos huérfanos.
