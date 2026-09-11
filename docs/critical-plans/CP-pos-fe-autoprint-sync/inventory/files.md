# Critical Files

- `apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation.component.ts` — Componente de confirmación de venta del POS, orquestador del auto-print (`maybeAutoPrint`), manejo de estados fiscales (`onFiscalStatus`) y UI de retroalimentación al cajero.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-fiscal-status.component.ts` — Indicador inline del estado fiscal, sondeo hacia el backend (`load`, `schedulePoll`, `statusChanged`) y control de reintentos.
- `apps/frontend/src/app/private/modules/store/pos/services/pos-ticket.service.ts` — Servicio de impresión de tiquetes POS, resolución de configuración de impresora y llamada al gateway de impresión (`printTicket`, `resolveAndPrint`).
- `apps/frontend/src/app/private/modules/store/pos/services/pos-fiscal.service.ts` — Cliente HTTP para endpoints fiscales del POS (`getFiscalStatus`, `emit`).
- `apps/frontend/src/app/shared/services/print/document-print.service.ts` — Motor de impresión unificado en frontend, interactúa con el Print Gateway (`resolveAndPrint`, `sendToPrinter`).
- `apps/backend/src/domains/store/print-formats/services/print-fiscal-gate.service.ts` — Compuerta fiscal en backend que resuelve si un documento se imprime como `pos_electronic_invoice` o `pos_sale_ticket`.
- `apps/backend/src/domains/store/invoicing/pos/pos-sale-completed.listener.ts` — Listener del evento `pos.sale.completed` que dispara la emisión en segundo plano tras el cobro.
- `apps/backend/src/domains/store/invoicing/pos/pos-fiscal-emission.service.ts` — Servicio core de emisión fiscal para POS, ejecuta la validación y transmisión a la DIAN.
- `apps/backend/src/domains/store/invoicing/pos/pos-fiscal.controller.ts` — Controlador que expone el estado fiscal de la orden (`/fiscal-status`) y la emisión manual (`/emit`).
