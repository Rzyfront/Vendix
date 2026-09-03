---
name: vendix-fiscal-scope
description: >
  Organization fiscal scope for Vendix: STORE vs ORGANIZATION legal/tax entity behavior,
  DIAN configuration ownership, fiscal accounting entities, fiscal reports, and intercompany transfers.
  Trigger: When working with organizations.fiscal_scope, fiscal accounting entities, DIAN NIT ownership, fiscal reports by NIT, fiscal scope migrations, intercompany stock-transfer entries, or gating a printed/displayed fiscal figure by fiscal state.
license: MIT
metadata:
  author: rzyfront
  version: "1.2"
  scope: [root]
  auto_invoke:
    - "Working with organizations.fiscal_scope"
    - "Changing fiscal scope behavior"
    - "Working with fiscal accounting entities"
    - "Working with DIAN NIT ownership"
    - "Working with fiscal reports by NIT"
    - "Working with fiscal scope migrations"
    - "Working with intercompany stock-transfer entries"
    - "Gating a printed or displayed fiscal figure (POS ticket, receipt, invoice copy) by fiscal state"
    - "Reusing a fiscal predicate that also governs write enforcement"
    - "Choosing the toSignal initialValue for a fiscal predicate"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Vendix Fiscal Scope

## Purpose

Use this skill whenever a change depends on whether an organization is one legal/tax entity or each store is its own legal/tax entity.

Fiscal scope is independent from operating scope. Operating scope controls operational sharing such as inventory and locations. Fiscal scope controls invoicing, DIAN configuration ownership, accounting entity selection, fiscal periods, and tax reports.

## Core Rules

- `fiscal_scope=STORE`: every active store needs its own fiscal accounting entity and DIAN invoicing configuration.
- `fiscal_scope=ORGANIZATION`: the organization uses one consolidated fiscal accounting entity.
- `operating_scope=STORE + fiscal_scope=ORGANIZATION` is invalid.
- `operating_scope=ORGANIZATION + fiscal_scope=STORE` is valid and means inventory may move cross-store while invoices/reports remain separated by store NIT.
- Resolve fiscal accounting entities through `FiscalScopeService`; do not use `OperatingScopeService.resolveAccountingEntity()` for invoicing, DIAN, tax reports, or automatic accounting entries.
- Fiscal scope changes must go through `FiscalScopeMigrationService` so blockers, force reasons, cache invalidation, and audit logs are preserved.

## Business Rules

- Onboarding `STORE_ADMIN` maps to `operating_scope=STORE`, `fiscal_scope=STORE`.
- Onboarding consolidated `ORG_ADMIN` maps to `operating_scope=ORGANIZATION`, `fiscal_scope=ORGANIZATION`.
- Onboarding federated fiscal `ORG_ADMIN` maps to `operating_scope=ORGANIZATION`, `fiscal_scope=STORE`.
- DOWN fiscal migration (`ORGANIZATION -> STORE`) is blocked by pending DIAN invoices, pending DIAN responses, open consolidated fiscal periods, missing store DIAN configs, missing store tax IDs, and open intercompany/consolidation records.
- Force is allowed only for fiscal DOWN with an explicit reason of at least 10 characters and blocker snapshot audit.
- UP fiscal migration (`STORE -> ORGANIZATION`) cannot be forced through invalid operating/fiscal combinations.

## Data Model Rules

- `organizations.fiscal_scope` is the organization-level fiscal source of truth.
- `accounting_entities` must include `fiscal_scope`; fiscal uniqueness must include fiscal scope and protect active consolidated entities where `store_id IS NULL`.
- `dian_configurations.store_id` remains the compatibility anchor, with `accounting_entity_id` derived from fiscal scope.
- `fiscal_scope_audit_log` is separate from `operating_scope_audit_log`.

## Entity Resolution Rules (write/read symmetry)

- Write side (`FiscalScopeService.ensureFiscalAccountingEntity`) and read side (`StorePrismaService.resolveFiscalEntityForContext`) must resolve the **same** accounting entity. The canonical lookup predicate is `{ organization_id, store_id, scope, fiscal_scope }` — the mirror of the DB unique `accounting_entities_org_store_scope_fiscal_scope_key`.
- Never relax one side without the other: an entity found on write but not on read produces ghost rows (persisted but invisible in scoped lists). This caused invisible `invoice_resolutions` (fixed by migration `20260609133158_align_accounting_entities_fiscal_scope`).
- `is_active: true` belongs to the **read** predicate only. Writes must not implicitly reactivate or bypass a deactivated entity; if write-side lookup misses because the entity is inactive, surface the error instead of creating a duplicate (the unique constraint will reject it).
- Models listed in `StorePrismaService.fiscal_entity_required_models` have a NOT NULL `accounting_entity_id` (e.g. `invoice_resolutions`, `payroll_runs`, `fiscal_obligations`, `tax_declaration_drafts`, `fiscal_close_sessions`, `fiscal_transmissions`, `fiscal_evidences`, `fiscal_operation_events`). For them:
  - Never filter with `accounting_entity_id: null` — Prisma rejects null filters on required fields (`PrismaClientValidationError`), and the legacy null-entity branch is meaningless.
  - Scope strictly by `accounting_entity_id: <resolved_id>`; when no entity resolves, use `accounting_entity_id: { in: [] }` to return a guaranteed-empty set.
- When adding a model to `fiscal_entity_scoped_models`, check the nullability of its `accounting_entity_id` column and register it in `fiscal_entity_required_models` if NOT NULL.

## Predicate Default Rules (write/display asymmetry)

A fiscal predicate derived from `fiscal_data` needs the **opposite** default depending on what it governs. Reusing one predicate for both purposes is a recurring bug source.

| Governs | Indeterminate (`fiscal_data` absent/incomplete) | Rationale | Example |
| --- | --- | --- | --- |
| **Write enforcement** (block/allow an operation) | Strict — block, and say how to unblock | Charging a tax the merchant may not be entitled to collect is not recoverable by a later commit; a block with a CTA is | `assertCanChargeVat` throws `FISCAL_VAT_NOT_RESPONSIBLE_001` (HTTP 412) with `cta: '/admin/fiscal/wizard'` |
| **Display / print** (state a fiscal figure) | Strict — do not show | Paper leaves with the buyer and cannot be retracted; never assert what the merchant cannot back | `selectPrintsVatBreakdown` returns `false` |

- **The VAT predicate fails CLOSED since 2026-08-21.** Indeterminate `fiscal_data` resolves to *not responsible*, on both sides: `resolveVatResponsibility` in `apps/backend/src/common/helpers/vat-responsibility.helper.ts:138` and its branch-by-branch mirror `resolveIsVatResponsible` in `apps/frontend/src/app/core/store/auth/auth.selectors.ts:383`. Earlier revisions of this skill prescribed the opposite (`true`, permissive) — that guidance is dead. Do not "restore" it.
- The strict default is affordable **only because it carries a way out**. `assertCanChargeVat` throws a registered code with a CTA to the fiscal wizard, so a merchant who never loaded fiscal data is told what to do rather than silently denied. A strict default with no CTA is the regression the permissive default was protecting against — if you add a fiscal gate, add the CTA in the same commit.
- `resolveVatResponsibility` returns three states, not two: `{ responsible, indeterminate, reason, source }`. `indeterminate` is what lets a consumer distinguish "declared O-49" from "we could not read it", and `source: 'absent' | 'read_error'` separates *go configure your fiscal area* from *retry*. Prefer it over the `boolean` shims (`isVatResponsible`, `VatResponsibilityService.resolve`) whenever the answer is shown to a human.
- **A `catch` around a fiscal read must not invent a responsibility.** Use `vatResponsibilityReadFailure()`; a wrapper that returns `true` on error makes the system assert "you are VAT responsible" without knowing it, and two such wrappers disagreeing produced opposite fiscal claims about the same invoice minutes apart.
- Never flip the default of a shared predicate to fix a display bug. `resolveIsVatResponsible` also feeds `assertCanChargeVat` (backend) and `selectIsExplicitlyNotVatResponsible` → `isVatBlocked` → `FiscalGateService`. **Derive a new predicate instead.**
- `fiscal_status.<area>.state` (`ACTIVE|LOCKED`) is the reliable "this merchant did the fiscal work" signal. `fiscal_data` can be partially populated, so it is not a substitute. Reuse `selectActiveFiscalAreas` rather than re-comparing states.
- The `toSignal` `initialValue` answers a different question than the predicate: it covers the hydration window **before** any fiscal data has arrived, not the indeterminate case after it has. `isVatResponsible` → `true` and `isVatBlocked` → `false` (`auth.facade.ts:284-286`) so the UI does not flash a blocked state while auth loads; `printsVatBreakdown` → `false`, because a printed figure cannot be retracted. Follow the default of the **use**, not of the source selector.
- Smell to catch in review: a `!== false` (or `?? true`) at a call-site of a fiscal predicate. It is an attempt to compensate a wrong default downstream, and it fails whenever the upstream branch already resolved the indeterminate case to `true`.
- When a fiscal figure is hidden, re-check the document's arithmetic. Totals usually arrive as independent backend fields (e.g. `subtotal` = tax-free base, `total_amount` = taxed), so removing one row can leave an orphaned difference. Hide the dependent rows too, or print the final amount only.

## Fiscal Identity Resolution

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

## Reporting Rules

- Fiscal reports by NIT should filter by `accounting_entries.accounting_entity_id`.
- `store_id` filters are operational breakdowns; `accounting_entity_id` filters are fiscal/legal filters.
- When both filters are provided, validate that the entity belongs to the organization and matches the store when the entity is store-scoped.

## Intercompany Rules

- In `operating_scope=ORGANIZATION + fiscal_scope=STORE`, cross-store stock transfers are operationally allowed but fiscally intercompany.
- Intercompany transfer entries use:
  - `intercompany_transfer.shipped.receivable`
  - `intercompany_transfer.shipped.inventory`
  - `intercompany_transfer.received.inventory`
  - `intercompany_transfer.received.payable`
- Accounting failures must be logged by the listener and must not roll back the completed stock-transfer transaction.

## Related Skills

- `vendix-operating-scope`
- `vendix-auto-entries`
- `vendix-accounting-rules`
- `vendix-prisma-migrations`
- `vendix-validation`
- `vendix-tax-typing` - typed `tax_type` contract carried by the figures these predicates gate
- `vendix-zoneless-signals` - `toSignal` / `initialValue` rules for the frontend side of a fiscal predicate
