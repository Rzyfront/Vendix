# Reusable Assets

- `apps/frontend/src/app/private/modules/store/pos/services/pos-fiscal.service.ts` — Métodos `getFiscalStatus(orderId)` y `emit(orderId)` que manejan la comunicación HTTP y desenvuelven el estado tipado `PosFiscalStatus`.
- `apps/frontend/src/app/shared/services/print/document-print.service.ts` — Método `resolveAndPrint(...)` para ejecutar la impresión transparente a través del gateway de impresión del backend.
- `apps/frontend/src/app/shared/components/toast/toast.service.ts` — Notificaciones contextuales para el usuario (`success`, `warning`, `error`, `info`).
- `apps/frontend/src/app/core/store/auth/auth.facade.ts` — Señales reactivas del estado de autenticación y áreas fiscales (`printsVatBreakdown`, `activeFiscalAreas`).
- `apps/frontend/src/app/core/store/store-settings/store-settings.facade.ts` — Acceso zoneless a configuraciones de tienda (`settings()`, `receipts()`, `pos()`).
- `apps/backend/src/domains/store/print-formats/services/print-fiscal-gate.service.ts` — Lógica autoritativa para resolver si un pedido tiene FE emitida (`resolvePosPrintTarget`).
