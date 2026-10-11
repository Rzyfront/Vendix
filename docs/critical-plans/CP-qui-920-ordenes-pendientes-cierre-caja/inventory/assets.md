# Reusable Assets
- `apps/backend/src/domains/store/cash-registers/sessions/sessions.service.ts` — computeCashSummary y guard stale CASH_SESSION_EXPECTED_STALE_001
- `apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts` — finalización canónica con inventario/eventos
- `apps/backend/src/domains/store/orders/orders-bulk.service.ts` — preview y selección por ID; no reusar transición forzada en caja
- `apps/frontend/src/app/private/modules/store/pos/components/pos-session-close-modal.component.ts` — modal compartido por POS/admin y polling de resumen
- `apps/frontend/src/app/private/modules/store/pos/services/pos-cash-register.service.ts` — fachada HTTP y tipos de reporte
- `apps/mobile/src/features/pos/components/pos-cash-close-modal.tsx` — interfaz de cierre Expo
- `apps/frontend/src/app/private/modules/store/pos/components/cash-session-report.component.ts` — reporte usado en cierre y detalle
