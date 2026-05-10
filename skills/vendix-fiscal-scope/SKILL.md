---
name: vendix-fiscal-scope
description: >
  Organization fiscal scope for Vendix: STORE vs ORGANIZATION legal/tax entity behavior,
  DIAN configuration ownership, fiscal accounting entities, fiscal reports, and intercompany transfers.
  Trigger: When working with organizations.fiscal_scope, fiscal accounting entities, DIAN NIT ownership, fiscal reports by NIT, fiscal scope migrations, or intercompany stock-transfer entries.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
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
