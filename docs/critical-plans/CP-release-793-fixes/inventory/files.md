# Critical Files

<!-- [MANDATORY] Concrete paths only, zero wildcards — one line per file: `path/to/file.ts` — role. -->

`apps/frontend/src/app/private/modules/store/invoicing/components/invoice-detail/invoice-detail.component.ts` — F-001: comentario con backticks L726.
`apps/frontend/src/app/private/modules/store/invoicing/pages/invoice-create-page/invoice-create-page.component.ts` — F-001: backticks L1549 y L3016.
`apps/backend/src/domains/store/analytics/services/customers-analytics.service.ts` — F-002: 5 queries con `state = 'abandoned'`.
`apps/frontend/src/app/private/modules/store/pqr/pages/pqr-detail-page/pqr-detail-page.component.ts` — F-003: defaults fail-open L76.
`apps/frontend/src/app/shared/components/toggle/toggle.component.ts` — F-004: OFF habilitado en danger L40.
`apps/frontend/src/app/private/modules/ecommerce/pages/checkout/checkout.component.ts` — F-005: preseleccion L1766.
`apps/backend/src/domains/support/pqr/pqr-notifications.listener.ts` — F-006: roles no canonicos L243 y L296.
`apps/backend/src/domains/store/print-formats/providers/pos-sale-ticket.provider.ts` — F-007: formato sin decimales.
`apps/backend/src/domains/store/shipping/shipping-calculator.service.ts` — F-008: threshold L200.
`apps/backend/src/domains/support/pqr/pqr.service.ts` — F-009: gate eliminado L242.
`apps/frontend/src/app/private/modules/store/invoicing/components/invoice-note-create/invoice-note-payload.util.ts` — F-010: header stale L8.
`apps/frontend/src/app/private/modules/store/invoicing/utils/invoice-line-math.ts` — F-011: docblock L143.
`apps/frontend/src/app/private/modules/store/ecommerce/ecommerce.component.ts` — F-012: doble save L1565 y L1790.
`apps/frontend/src/app/public/ecommerce/components/storefront/storefront.component.ts` — F-013: helper `prepMinutesFor`.
`apps/frontend/src/app/private/modules/ecommerce/components/product-card/product-card.component.ts` — F-013: pinta crudo L118.
`apps/frontend/src/app/private/modules/ecommerce/pages/product-detail/product-detail.component.ts` — F-013: pinta crudo L401.
`apps/frontend/src/app/private/modules/store/settings/shipping/components/add-rate-wizard-modal/add-rate-wizard-modal.component.ts` — F-014: OR-cero L280.
`apps/frontend/src/app/public/ecommerce/pages/pqr/pqr-submit.component.ts` — F-015: parseInt L180.
`apps/backend/src/domains/store/invoicing/credit-notes/credit-notes.service.ts` — F-010: kernel `derivePartialNoteLinesViaKernel` L339.
`apps/backend/src/domains/store/invoicing/services/invoice-calculator.service.ts` — F-010/F-011: `resolveRateBasis` L1971 y motor L959.
`apps/backend/src/domains/ecommerce/checkout/checkout.service.ts` — contexto idempotencia (sin findings, verificado limpio).
`apps/backend/src/main.ts` — core verificado: solo headers CORS Idempotency-Key.
