# DIAN enablement: anti-patterns and review checklist

## Anti-patterns

- Physical `DELETE` on `invoice_resolutions`, or an "Eliminar" button.
- Resetting/lowering `current_number`, or reopening a prefix an archived row occupies.
- A second implementation of the "active resolution" `where`, or of the internal-series defaults (preview vs emission diverge).
- Writing to `invoice_resolutions` without `lockResolutionSeries`.
- Applying the cross-account guard to internal note series (violates D10), or skipping it for archived rows.
- Returning a raw `invoice_resolutions` / `dian_configurations` row from a controller.
- Restricting inheritance to superadmin, or revalidating the source's suspension.
- Migrating existing `NC`/`ND` series to `NCVS`/`NDVS`.
- Persisting wizard progress or adding a parallel activation flow.
- Migrations with `UPDATE`/`DELETE`/`DROP`/`CASCADE` on these tables (see `vendix-prisma-migrations`).

## Review checklist

- [ ] New series use `buildInternalSeriesDefaults`; no hardcoded range/validity/prefix.
- [ ] "In use" computed by `activeResolutionWhere`; note types keep a single active series, under `lockResolutionSeries`.
- [ ] Used series stay immutable (`_005`); unused note series editable/creatable (D10).
- [ ] Delete paths archive; archive validations `_012`..`_016` intact in all three lanes.
- [ ] New create/update/apply-range paths call `assertNoCrossTenantNumberingOverlap` (with `lock_in_transaction` in a tx); internal series excluded.
- [ ] Responses use `toPublicResolution` / `maskSensitiveFields`; no `technical_key*`, fingerprints or foreign ids.
- [ ] Any `withoutScope()` read is fiscal-control only and returns counts/booleans/ranges.
- [ ] Inheritance requires PIN match, writes `enablement_evidence.inheritance` + audit log, copies no foreign evidence.
- [ ] Wizard entry points route to `/admin/invoicing/activation`; no persisted progress.
- [ ] Specs touched: `invoice-number-generator.spec.ts`, `resolution-archive.util.spec.ts`, `cross-tenant-numbering-guard.util.spec.ts`, `dian-config.enablement-inheritance.spec.ts`, `resolutions.service.spec.ts`.
