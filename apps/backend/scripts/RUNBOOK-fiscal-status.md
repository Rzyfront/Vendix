# Fiscal Status Migration Runbook

## Preflight

1. Confirm the Prisma schema migration `add_fiscal_status_audit_log` is applied.
2. Take an RDS snapshot.
3. Export a focused backup:
   `pg_dump --table=store_settings --table=organization_settings --column-inserts`.

## Dry Run

```bash
npm run migrate:fiscal-status -- --dry-run
```

Review `scanned`, `updated`, `skipped`, and tenant details. Dry run is the default.

## Execute

```bash
npm run migrate:fiscal-status -- --run
```

Use `--force` only if you intentionally want to rewrite an existing
`settings.fiscal_status` block.

## Verify

```bash
npm run verify:fiscal-status
```

The verifier must return `discrepancies_count: 0` and
`missing_fiscal_status: 0` before promoting the deploy.

## Rollback

Restore the RDS snapshot or replay the `pg_dump` backup into
`store_settings` and `organization_settings`. The migration is additive; the
old `module_flows` block remains in JSON during the release window.
