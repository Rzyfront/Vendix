---
name: vendix-dian-enablement
description: >
  DIAN enablement and numbering rules for Vendix electronic invoicing: internal note series
  (NCVS/NDVS/NASVS/NAEVS), "in use" and single active note series, logical archiving of resolutions,
  cross-account numbering guard (INVOICING_RESOLUTION_017), enablement inheritance by PIN + software ID,
  what DIAN configuration data may never leave the backend, and the single activation wizard.
  Trigger: When creating or editing DIAN resolutions or note series, working on enablement / test set / promotion to production, enablement inheritance, the cross-account numbering guard, exposing DIAN configuration data over HTTP, or the activation wizard.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Creating or editing DIAN resolutions or internal note series (NCVS/NDVS/NASVS/NAEVS)"
    - "Archiving, activating or choosing the in-use resolution for a document type"
    - "Working on DIAN enablement, test set or promotion to production"
    - "Working on enablement inheritance between DIAN configurations (PIN + software ID)"
    - "Touching the cross-account numbering guard (INVOICING_RESOLUTION_017)"
    - "Exposing DIAN configuration or resolution data over HTTP (technical_key, fingerprints, source ids)"
    - "Working on the electronic invoicing activation wizard (/admin/invoicing/activation)"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Vendix DIAN Enablement and Numbering

## Purpose

Rules that keep three things safe in electronic invoicing: **numbering** (a consumed DIAN consecutive is irrecoverable),
**enablement** (who may issue in production) and **data exposure** (ClTec and cross-account pointers).
Owner decisions D1-D13 live in the working plan; this skill records what the code enforces and where.

Link, do not duplicate: fiscal entity/NIT ownership -> `vendix-fiscal-scope`; issuer calidades/UBL party block -> `vendix-dian-issuer-identity`;
tax typing -> `vendix-tax-typing`; migrations -> `vendix-prisma-migrations`; scoped Prisma / `withoutScope` -> `vendix-prisma-scopes`;
error codes -> `vendix-error-handling`.

Paths below are under `apps/backend/src/domains/store/invoicing/` (`BE`) unless noted.

## Rule 1 - Internal note series (NCVS/NDVS/NASVS/NAEVS)

- Document types with an internal (non-DIAN-authorized) series declare it in `internal_series_prefix` of `FISCAL_DOCUMENT_REQUIREMENTS`
  (`BE/fiscal-document-requirements.ts`): credit note `NCVS`, debit note `NDVS`, support-document adjustment `NASVS`, equivalent-document adjustment `NAEVS` (D1, D3).
  `internalSeriesPrefixFor(type)` is the single predicate "does this type have an internal series".
- A NEW series opens with `buildInternalSeriesDefaults` in `BE/utils/invoice-number-generator.ts`: `range_from=1`,
  `range_to=INTERNAL_SERIES_INITIAL_RANGE` (10,000,000), validity `INTERNAL_SERIES_VALIDITY_YEARS` (100 years, `valid_to` is NOT NULL but never reached), no ClTec.
  Auto-extension by `INTERNAL_SERIES_BLOCK` stays only as a safety net.
- **Why:** the old `NC`/`ND` prefix collided with prefixes already reported to DIAN by a previous provider under the same NIT.
- **Existing `NC`/`ND` series are NOT migrated (D1).** The generator reactivates an existing dormant series before creating a new one, so entities with `NC` keep issuing `NC<n+1>`. Never relabel emitted numbering.
- Single source of truth: the real emission (`provisionInternalSeries`) and the preview (`InvoicingService.peekInternalSeries` / `BE/utils/resolutions-in-use.util.ts`) must both consume `buildInternalSeriesDefaults`. Never hardcode range/validity elsewhere (frontend copy of the requirements table must mirror it).

## Rule 2 - "In use" and a single active note series

- "In use" = the row the generator would pick. `activeResolutionWhere` / `findActiveResolution` in `BE/utils/resolution-selection.util.ts` is the ONE definition (active, not archived, within validity, newest). `GET store/invoicing/resolutions/in-use` (`BE/resolutions/resolutions.controller.ts`, declared before `:id`) reuses it via `BE/utils/resolutions-in-use.util.ts`. Do not write a second `where`.
- Types with an internal series (`isSingleActiveDocumentType`) allow ONE active series per (accounting entity, document type). Activating/creating one runs `deactivateOtherActiveSeries` inside the same transaction.
- Concurrency: emission, create, edit and archive share the same advisory lock via `lockResolutionSeries` / `resolutionSeriesLockKey` (`invoice_resolution:<entity>:<type>`). Any new write path on `invoice_resolutions` must take it.
- Sales invoices may legitimately have several active resolutions; do not force the single-active rule on them.
- **D10:** an UNUSED note series (`current_number < range_from`) is editable (prefix, range, validity) and creatable by the user; the generator uses the series the user created/activated, never a fabricated default. Once numbering is consumed, `prefix`, `document_type`, `range_from` and `resolution_number` are immutable (`INVOICING_RESOLUTION_005`, `BE/resolutions/resolutions.service.ts`); create a new series instead.

## Rule 3 - Logical archiving, never physical deletion (D4/D5)

- `invoice_resolutions.archived_at` / `archived_by_user_id` (migration `20261022120000_invoice_resolutions_archived`, additive). `DELETE store/invoicing/resolutions/:id` and `POST :id/archive` both ARCHIVE (`BE/utils/resolution-archive.util.ts`: `assertResolutionArchivable`, `archiveResolutionInTx`). The UI must not offer "Eliminar".
- An archived row keeps `is_active=false`, keeps occupying its prefix in the partial unique indexes (so `NC1` can never be reopened), keeps the FK from `invoices.resolution_id` (PDF and retransmission still read it), and is never reactivated by the generator (`dormantInternalSeriesWhere` filters `archived_at: null`).
- Archiving is refused with: `INVOICING_RESOLUTION_012` (in-flight documents: `IN_FLIGHT_TRANSMISSION_STATUSES` or retry queue), `_013` (wired to the platform fiscal configuration `invoice_resolution_id`), `_014` (test set running on the same axis), `_015` (it is the note series in use and no valid replacement prefix, see `REPLACEMENT_PREFIX_PATTERN`). Edits on an archived row: `_016`.
- Issued fiscal documents (notes included) are never deleted. "Delete an inactive credit note" means archive the inactive SERIES.
- Apply the same behavior in all three lanes: store (`BE/resolutions/resolutions.service.ts`), organization (`domains/organization/invoicing/invoice-resolutions/invoice-resolutions.service.ts`) and platform (`domains/superadmin/subscriptions/fiscal/subscription-fiscal.service.ts`).

## Rule 4 - Cross-account numbering guard (`INVOICING_RESOLUTION_017`)

- DIAN numbers by (issuer NIT, prefix, document type). Two accounts that declare the same NIT (demo stores using the platform software) with overlapping ranges would emit duplicate consecutives, which DIAN rejects irreversibly (D11).
- `assertNoCrossTenantNumberingOverlap` in `BE/utils/cross-tenant-numbering-guard.util.ts` is the single implementation. Call it from create/update/apply-range paths (`resolutions.service.ts`, `dian-numbering-range.service.ts`, organization service).
- The issuer NIT set of an entity is the union of `accounting_entities.tax_id` and `dian_configurations.nit`, normalized by `normalizeIssuerNit` (digits only, DV dropped).
- Counts ARCHIVED rows too (they still occupy numbers). Inside a transaction pass `lock_in_transaction: true` to take the advisory lock by (NIT, prefix, type) so two accounts cannot pass the guard simultaneously.
- **D10 exception:** types with an internal series (`internalSeriesPrefixFor !== null`) are skipped: that numbering is ours, not DIAN's.
- The error exposes only the requested range and the occupied ranges, never ids, names or accounts of the other party.

## Rule 5 - Enablement inheritance (D12, D13)

- A configuration (`own_software`, `not_started` or `testing`) can inherit the enablement of another `dian_configurations` row with the same NIT + `software_id` + `configuration_type` that is `enabled` or `test_set_passed` with passing evidence. `getEnablementInheritance` (`GET :id/enablement-inheritance`) and `inheritEnablement` (`POST :id/inherit-enablement`) in `BE/dian-config/dian-config.service.ts`.
- **D12:** anyone who knows the software PIN and ID inherits; do NOT restrict to superadmin. The guard is the PIN match (`softwarePinsMatch`, error `DIAN_CONFIG_004`) because NIT and software_id travel in every XML and are not secrets.
- **D13:** the source is NOT revalidated afterwards. If the original is suspended, the inheritor is not notified; emission errors tell the user. Do not add suspension polling.
- Audited, not silent: the target gets `enablement_inherited_from_id` (self-FK `ON DELETE SET NULL`, migration `20261022130000_dian_config_enablement_inheritance`), `enablement_evidence.inheritance` (source id, status, environment, NIT, software, `inherited_by_user_id`, `legal_notice`) and a `dian_audit_logs` row `enablement_inherited`.
- Evidence is sanitized: only the minimal verdict is copied. Never copy `resolution_id`, CUFEs, zip keys or `raw_response` from another tenant's evidence.
- Documents issued by a demo are legally valid in the name of the NIT that owns the software (D6); the `legal_notice` must stay visible to the user.

## Rule 6 - What never leaves the backend

- `technical_key`, `technical_key_encrypted`, `technical_key_fingerprint` (ClTec = 14th CUFE input; the fingerprint correlates tenants). Every resolution response goes through `toPublicResolution` (`BE/resolutions/resolutions.service.ts`), which returns `technical_key_set` and `technical_key_length` instead. Used by store, organization and platform lanes; new endpoints must reuse it, not select the raw row.
- PIN and certificate password are masked; the id of the inheritance source (possibly another account) is replaced by `enablement_inherited` and removed from `enablement_evidence.inheritance` in `maskSensitiveFields` (`dian-config.service.ts`). The column and audit keep the real value.
- Cross-account reads (`withoutScope()`) are allowed ONLY for fiscal controls (numbering guard, enablement source lookup, ClTec sharing checks) and must `select` the minimum and return counts, booleans or ranges. Never ids, names, orgs or stores of other accounts. Add an explicit tenant filter whenever you use `withoutScope()` for anything else.
- `production-readiness` and the platform `resolutions-for-emission` used to leak `resolutions[].technical_key` and a fingerprint; both were fixed (SEC-1 `8e7612e3d`, SEC-2 `427613cc4`) and now return only `technical_key_set`/`technical_key_length`. Never reintroduce raw ClTec or fingerprints in a response.

## Rule 7 - One activation wizard (D8)

- `/admin/invoicing/activation` (store route `apps/frontend/src/app/private/modules/store/invoicing/invoicing.routes.ts`; organization route reuses the same component) is the ONLY entry to enable electronic invoicing: company, software, certificate, test set, production ranges, promotion. The fiscal wizard step `dian_config` and the old DIAN wizard redirect there.
- Progress is DERIVED from backend state (`fiscal-readiness`, `production-readiness`, `enablement_status`), never persisted (`activation-wizard/activation-step.util.ts`). One source of truth: do not add a second progress flag or a parallel flow.
- Steps compose the shared panels in `apps/frontend/src/app/shared/components/dian/`; do not fork them.
- Frontend work also requires `vendix-zoneless-signals`.

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
