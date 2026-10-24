# D.1 â AuditorÃ­a estÃ¡tica parcial

Fecha: 2026-10-14

## Contratos de reserva

- El prechequeo genÃ©rico de `ReservationsService` podÃ­a responder `SYS_INTERNAL_001` ante proveedor ocupado, en lugar de ERR-03 (`STATION_003`). Para servicios con estaciÃ³n, create y hold delegan ahora la disponibilidad al `ServiceAllocationCoordinator`; para servicios legacy se conservan los prechequeos existentes.
- La autoasignaciÃ³n en un servicio con estaciÃ³n y proveedor requerido ahora devuelve `STATION_003` cuando hay proveedores activos del servicio pero ninguno disponible en el intervalo.
- El coordinador verifica compatibilidad, horario y colisiÃ³n dentro de la transacciÃ³n; el conflicto de proveedor con ID explÃ­cito tambiÃ©n produce `STATION_003`.

## Accesibilidad

- Los bloques libres y las reservas del calendario diario/semanal aceptan Enter y Espacio y tienen nombres accesibles.
- Las tarjetas de proveedor, selector de vistas, fecha, hora y modalidad exponen estados seleccionados; los selectores de estaciÃ³n/fecha reciben etiqueta.
- La revisiÃ³n estÃ¡tica no comprueba foco real, lector de pantalla, contraste ni reflow/zoom.

## VerificaciÃ³n y lÃ­mites

- `git diff --check`: pasa.
- `cp-lint.sh`: pasa.
- No se ejecutaron pruebas ni compilaciones en esta revisiÃ³n.
- No existen todavÃ­a `evidence/verify-fb.sh`, `verify-db.sh` ni `verify-err.sh`; las filas de registros permanecen sin verificar.
- El backend, nginx y frontend activos apuntan a `/home/dmin/Vendix`, no a este worktree. No se ejecutÃ³ trÃ¡fico funcional contra esa instancia ni se aplicaron migraciones.
- Pendientes: reproducir ERR-03 y carreras en entorno aislado, correr suite de contratos, pruebas de accesibilidad/browser y las verificaciones D.1 de concurrencia, zona horaria, multi-tienda, checkout y base de datos.

## Referencias

- `apps/backend/src/domains/store/reservations/reservations.service.ts`
- `apps/backend/src/domains/store/reservations/service-allocation-coordinator.service.ts`
- `apps/frontend/src/app/shared/components/booking-scheduler-modal/booking-scheduler-modal.component.ts`
- `apps/frontend/src/app/private/modules/store/reservations/components/calendar/calendar-day-view/calendar-day-view.component.html`
- `apps/frontend/src/app/private/modules/store/reservations/components/calendar/calendar-week-view/calendar-week-view.component.html`