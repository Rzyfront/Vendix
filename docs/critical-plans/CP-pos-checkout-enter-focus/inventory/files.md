# Critical Files

<!-- [MANDATORY] Concrete paths only, zero wildcards — one line per file: `path/to/file.ts` — role. -->

- `apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/pos-checkout-shell.component.ts` — HostListener Enter, attemptNextStep, foco del panel, CTA terminal.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/steps/pos-consumo-step.component.ts` — fulfillment entrega/consumo y avance a mesa.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/steps/pos-payment-step.component.ts` — preselect Efectivo y driver del sub-wizard de cobro.
- `apps/frontend/src/app/shared/components/payment-collector/payment-collector.component.ts` — sub-wizard Forma→Método→Monto, gates canSubmit/canConfirmAmount.
- `apps/frontend/src/app/shared/components/payment-collector/payment-collector.component.html` — inputs de caja/referencia donde vive el Enter del monto.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-product-selection.component.ts` — buscador POS; expone focusSearch().
- `apps/frontend/src/app/private/modules/store/pos/pos.component.ts` — cierres de modales; invoca focusSearch().
- `apps/frontend/src/app/shared/components/inputsearch/inputsearch.component.ts` — focusInput() reutilizable.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/pos-checkout-shell.component.spec.ts` — specs Enter existentes + nuevos.
