# Critical Files

<!-- [MANDATORY] Concrete paths only, zero wildcards — one line per file: `path/to/file.ts` — role. -->

`apps/backend/src/domains/ecommerce/checkout/checkout.service.ts` — web/whatsapp checkout, draft creation, shipping guards.
`apps/backend/src/domains/ecommerce/checkout/dto/checkout.dto.ts` — checkout DTO (shipping ids optional).
`apps/backend/src/domains/store/invoicing/invoicing.service.ts` — `createFromOrder`, eligibility gate.
`apps/backend/src/domains/store/invoicing/invoice-flow/invoice-flow.service.ts` — `validate`/`send`/`accept` state machine.
`apps/backend/src/domains/store/invoicing/pos/pos-fiscal-emission.service.ts` — `emitForOrder` (POS auto-emit).
`apps/backend/src/domains/store/invoicing/pos/pos-sale-completed.listener.ts` — POS_SALE_COMPLETED_EVENT listener.
`apps/backend/src/domains/store/invoicing/invoice-data-requests/invoice-data-requests.service.ts` — guest data + sendBestEffort.
`apps/backend/src/domains/store/invoicing/invoicing.controller.ts` — manual `PATCH :id/send`, `:id/accept`.
`apps/backend/src/domains/store/payments/payments.service.ts` — POS sale, draft short-circuit, emit event.
`apps/backend/src/domains/store/payments/payments.controller.ts` — charge endpoint incl. draft orders.
`apps/backend/src/domains/store/tables/table-sessions.service.ts` — table flow (no fiscal code; verified).
`apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts` — assign-shipping validation to reuse.
`apps/backend/src/domains/store/payments/services/webhook-handler.service.ts` — payment-approval hook for A.3.
`apps/backend/prisma/schema.prisma` — `invoices`, `invoice_resolutions`, `orders`, `invoice_data_requests` models.
