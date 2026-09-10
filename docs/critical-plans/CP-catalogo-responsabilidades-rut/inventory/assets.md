# Reusable Assets

- `apps/frontend/src/app/shared/components/fiscal-activation-wizard/steps/fiscal-legal-data-step.component.ts` — Working [catalog] wiring pattern for B.2 to replicate.
- `apps/backend/src/domains/store/invoicing/validators/customer-fiscal-identity.validator.ts` — TAX_RESPONSIBILITY_PATTERN shape-vs-membership policy to mirror.
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/xml/ubl-common.builder.ts` — resolveTaxCodeFromTax, tax_type dimension that must NOT change.
- `apps/backend/src/common/helpers/vat-responsibility.helper.ts` — resolveVatResponsibility() y isVatResponsible() para IVA y tratamiento de compras.
- `apps/frontend/src/app/shared/components/badge/badge.component.ts` — BadgeComponent para chips visuales de responsabilidades seleccionadas.
- `apps/frontend/src/app/shared/components/selector/selector.component.ts` — SelectorComponent para el selector de responsabilidades adicionales.
- `apps/frontend/src/app/shared/components/toggle/toggle.component.ts` — ToggleComponent para switches de responsabilidades frecuentes.
- `apps/frontend/src/app/shared/components/tooltip/tooltip.component.ts` — TooltipComponent para tooltips informativos con efectos y base legal.
- `apps/frontend/src/app/private/modules/fiscal-operations/services/fiscal-operations.service.ts` — getResponsibilitiesCatalog(scope) para el catálogo versionado del backend.
