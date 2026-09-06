# Database Contract Registry

| Id | Model / table | Columns | R/W | Tenant scoping | Migration | Consumers | Invariant | Verification | Status |
|----|---------------|---------|-----|----------------|-----------|-----------|-----------|--------------|--------|
<!-- | DB-01 | `invoices` | `total`, `state` | W | scoped client via store_id | `20260101_migration_name` | `invoicing.service.ts:871` | `total = sum(items) + taxes` | `SELECT ...` proving the invariant | [ ] | -->
