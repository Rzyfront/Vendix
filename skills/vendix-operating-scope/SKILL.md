---
name: vendix-operating-scope
description: >
  Organization operating scope STORE vs ORGANIZATION: inventory, suppliers, purchases, accounting, transfers, reports. Trigger: account_type, onboarding scope, store vs org visibility, locations, cross-store data access.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke:
    - "Working with organization operating scope STORE vs ORGANIZATION"
    - "Changing onboarding account_type behavior"
    - "Scoping inventory, suppliers, purchases, accounting, reports, or transfers by store vs organization"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Vendix Operating Scope

## Purpose

Use this skill whenever a change depends on whether an organization operates as one consolidated organization or as isolated stores.

## Core Rule

Vendix has one global operating scope per organization:

- `STORE`: every store is isolated.
- `ORGANIZATION`: operational and accounting data are shared/consolidated by organization.

Do not introduce mixed per-store scope unless the business explicitly changes this rule.

## Business Rules

- `SINGLE_STORE` onboarding maps to `operating_scope = STORE`.
- `MULTI_STORE_ORG` onboarding maps to `operating_scope = ORGANIZATION`.
- Scope changes go only through `OperatingScopeMigrationService` (`common/services/operating-scope-migration.service.ts`), which writes `operating_scope_audit_log` and invalidates the scope cache:
  - UP `STORE -> ORGANIZATION`: requires ≥2 active stores; ensures per-store and consolidated `accounting_entities`; history stays put.
  - DOWN `ORGANIZATION -> STORE`: rejected while consolidated POs (PENDING/APPROVED) or cross-store transfers are open, or while `fiscal_scope = ORGANIZATION` (change fiscal mode first, see `vendix-fiscal-scope`); forced downgrade requires a reason (≥10 chars).
  - Partners (`organizations.is_partner = true`) are locked to `STORE`; other targets → 403.
- In `STORE`, a store must not see another store's inventory, locations, suppliers, purchases, accounting, valuation, or reports.
- In `ORGANIZATION`, stores behave as channels/locations/segments under one organization scope.

## Implementation Rules

- Resolve scope through `OperatingScopeService`; do not duplicate scope decisions in feature services.
- For accounting, resolve `accounting_entities` through the operating scope.
- In `STORE`, operational records should carry `store_id` directly or be reachable through a store-scoped parent.
- In `ORGANIZATION`, records can use `organization_id` with `store_id = null` when they are shared.
- Cross-store stock transfers are not internal transfers in `STORE`; block them unless a future commercial/intercompany flow exists.

## Related Skills

- `vendix-prisma-scopes`
- `vendix-settings-system`
- `vendix-inventory-stock`
- `vendix-auto-entries`
- `vendix-accounting-rules`
- `vendix-fiscal-scope`
