---
name: vendix-fiscal-scope
description: >
  Organization fiscal scope for Vendix: STORE vs ORGANIZATION legal/tax entity behavior,
  DIAN configuration ownership, fiscal accounting entities, fiscal reports, and intercompany transfers.
  Trigger: When working with organizations.fiscal_scope, fiscal accounting entities, DIAN NIT ownership, fiscal reports by NIT, fiscal scope migrations, or intercompany stock-transfer entries.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke:
    - "Working with organizations.fiscal_scope"
    - "Changing fiscal scope behavior"
    - "Working with fiscal accounting entities"
    - "Working with DIAN NIT ownership"
    - "Working with fiscal reports by NIT"
    - "Working with fiscal scope migrations"
    - "Working with intercompany stock-transfer entries"
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
