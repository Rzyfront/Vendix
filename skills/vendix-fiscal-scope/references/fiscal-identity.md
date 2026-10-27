# Fiscal identity resolution

`fiscal_data` (JSON in `organization_settings.settings.fiscal_data` or `store_settings.settings.fiscal_data`) is the **single source of truth** for a tenant's fiscal identity (NIT, DV, razón social, dirección fiscal, municipio, responsabilidades, régimen, CIIU, tipo de persona, tipo de NIT). The columns of `organizations` and `stores` (`tax_id`, `verification_digit`, `tax_id_dv`, `legal_name`, `municipality_code`, etc.) are a **projection**, not a source.

### Read path

- `resolveTenantFiscalIdentity(source)` in `apps/backend/src/common/helpers/fiscal-identity.helper.ts` is the **only** place that decides precedencias between `fiscal_data`, columnas, y `addresses`. All consumers (DIAN, payroll, colillas, export bancario, suscripciones, status fiscal) MUST go through it.
- The wide contract `TenantFiscalIdentity` carries raw RUT vocabulary (`NIT`, `JURIDICA`, `O-13`, `COMUN`). DIAN consumers project it via `projectTenantIdentityToDian`; non-DIAN consumers (paystubs, bank export, subscription PDF) consume it directly without translating.
- The resolver **derives** (never reads from column or JSON):
  - `nit_dv` — módulo 11. A stored DV that disagrees with the calculation is wrong by definition.
  - `tax_regime` — derived from `tax_responsibilities` via `isVatResponsible`.
- The resolver **throws** when `legal_name`, `municipality_code`, or `department` are unresolvable. A rejected DIAN emission costs an unrecoverable authorized consecutive; failing before emission costs nothing.

### Write path

- `mergeFiscalData(existing, patch)` in `apps/backend/src/common/helpers/organization-fiscal-columns.helper.ts` is a **shallow** merge.
- `buildTenantFiscalColumns(scope, dto, merged)` projects columns for `'organization'` or `'store'` scope. Overloads return the exact column type per scope.
- The three writers of `fiscal_data` (organization/settings org branch, organization/settings store branch, store/settings) all call the dispatcher.

### Consumer update rule

- Anywhere that previously read `organizations.tax_id` / `stores.tax_id` / `verification_digit` / `tax_id_dv` / `tax_regime` to **build** an issuer/payer identity MUST go through `resolveTenantFiscalIdentity` instead. Column reads as fallback when the resolver returns empty or throws are acceptable; column reads as primary source are not.
- An audit test at `apps/backend/src/fiscal-identity-audit.spec.ts` runs in CI and fails the build if a file outside the helpers reads those columns for emission purposes. Adding to `EXPLICIT_EXCEPTIONS` requires a written justification.
