# C.2 â RevisiÃ³n estÃ¡tica de producto, estaciÃ³n y sesiÃ³n

Fecha: 2026-10-13

## Verificado en cÃ³digo

- El formulario de producto expone `requires_station` con etiqueta visible y explica que reserva/inicio quedan limitados a estaciones compatibles.
- El formulario de reserva muestra el selector obligatorio cuando el servicio requiere estaciÃ³n. Las opciones compatibles intersectan servicio y proveedor; al cambiar proveedor se vuelve a validar la selecciÃ³n.
- La agenda integra el panel de sesiones activas. El panel permite abrir atenciÃ³n, escoger estaciÃ³n, servicio y proveedor opcional, ver el tope configurado y administrar sesiones/propuestas. Anuncia estado de carga y hora de Ãºltima actualizaciÃ³n con `aria-live`.
- El panel pagina resultados para evitar ocultar sesiones activas mÃ¡s allÃ¡ de la primera pÃ¡gina.

## Pendiente

- No encontrÃ© en la pantalla de detalle de orden una presentaciÃ³n del tope aprobado, saldo disponible, importe pendiente y contacto de la sesiÃ³n. Ese criterio sigue abierto.
- No se verificÃ³ un recorrido integrado de menÃº/CTA desde producto a agenda, POS y orden, ni navegaciÃ³n a 360 px/teclado.
- El panel no presenta un mensaje especÃ­fico de modo sin conexiÃ³n. La actualizaciÃ³n fallida se anuncia como error, pero no comunica explÃ­citamente que la causa sea falta de red.
- RevisiÃ³n estÃ¡tica Ãºnicamente; browser, teclado, lector de pantalla y estados de API requieren entorno aislado.

## Referencias

- `apps/frontend/src/app/private/modules/store/products/pages/product-create-page/product-create-page.component.html`
- `apps/frontend/src/app/private/modules/store/reservations/components/reservation-form-modal/reservation-form-modal.component.html`
- `apps/frontend/src/app/private/modules/store/reservations/components/reservation-form-modal/reservation-form-modal.component.ts`
- `apps/frontend/src/app/private/modules/store/reservations/components/service-sessions-panel/service-sessions-panel.component.html`
- `apps/frontend/src/app/private/modules/store/reservations/reservations.component.html`
- `apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.html`