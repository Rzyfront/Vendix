# Reusable Assets

<!-- [MANDATORY] From Reuse Discovery — one line per asset: `path` — what it provides, or `none — <reason>` if empty. -->

`apps/backend/src/domains/store/print-formats/providers/fiscal-document-print.mapper.ts` — `money()` con 2 decimales pineados (reusar en F-007).
`apps/frontend/src/app/public/ecommerce/components/storefront/storefront.component.ts` — `prepMinutesFor()` validado (reusar en F-013).
`apps/backend/src/domains/store/invoicing/credit-notes/credit-notes.service.ts` — `derivePartialNoteLinesViaKernel` (fuente de verdad F-010).
`apps/frontend/src/app/private/modules/store/invoicing/utils/invoice-line-math.spec.ts` — harness de 318 lineas para paridad (extender en F-007/F-013).
`apps/backend/src/domains/support/pqr/pqr.service.spec.ts` — pins de conducta de tracking (extender en F-009).
`apps/backend/prisma/seeds/permissions-roles.seed.ts` — roles canonicos (fuente para F-006).
`skills/how-to-critical-plan/assets/cp-*.sh` — scaffolding, lint, ledger y contexto del bundle.
