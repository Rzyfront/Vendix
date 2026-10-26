# Failed migration recovery (detail for Rules 3 and 6)

Production: EC2 + Docker, RDS Postgres. API containers are `vendix-backend-blue` (:3001) / `vendix-backend-green` (:3002); `vendix-backend` (:3000) is the legacy name. Migrations run in a one-off container from `.github/workflows/deploy-backend-ec2.yml`. See `vendix-ec2-maintenance` for access.

## Diagnosis

```bash
sudo docker ps -a
sudo docker logs <container> --tail 100
PGPASSWORD=<password> psql -h <rds-host> -U postgres -d vendix_db -c "
SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, logs
FROM _prisma_migrations WHERE finished_at IS NULL;"
```

Check what was partially applied:

```sql
SELECT typname FROM pg_type WHERE typname = 'your_enum_name';
SELECT column_name FROM information_schema.columns
WHERE table_name = 'your_table' AND column_name IN ('col1', 'col2');
SELECT conname FROM pg_constraint WHERE conname = 'your_fk';
```

## Partially applied (most common with enums)

Complete idempotently, then mark applied:

```sql
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "weight" DECIMAL(10,3);
```

```bash
npx prisma migrate resolve --applied <migration_name>
```

Never `--rolled-back` on a partial apply: Prisma re-runs the whole SQL and row mutations (INSERT/UPDATE/DELETE) would execute twice in production.

## Clean failure (nothing applied)

Fix the SQL to be idempotent, then:

```bash
npx prisma migrate resolve --rolled-back <migration_name>
```

Last resort if the CLI cannot run: `DELETE FROM _prisma_migrations WHERE migration_name = '<name>';` (scoped by `WHERE`, recovery-only).

## Run Prisma CLI against prod

```bash
sudo docker run --rm --network=host --env-file /opt/vendix/.env --entrypoint sh <image> -c "npx prisma migrate status"
```

Then re-run the deploy and verify: `curl -s -o /dev/null -w "%{http_code}" https://api.vendix.online/api/health`.

## Checksum mismatch (P3012): "resolve + apply manual"

Use when `migrate dev` refuses to continue and you need a new corrective migration without resetting:

```bash
mkdir -p prisma/migrations/20260412000000_fix_whatever
cat > prisma/migrations/20260412000000_fix_whatever/migration.sql << 'SQL'
ALTER TYPE "my_enum" ADD VALUE IF NOT EXISTS 'new_value';
ALTER TABLE "my_table" ADD COLUMN IF NOT EXISTS "new_col" TIMESTAMP(6);
SQL
npx prisma migrate resolve --applied 20260412000000_fix_whatever
# then apply the same idempotent SQL to that DB (local recovery only)
```

If a modified migration file is already deployed and cannot be reverted, compare checksums and, only as recovery, align the stored one:

```sql
SELECT migration_name, checksum, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 10;
UPDATE _prisma_migrations SET checksum = '<checksum_of_current_file>'
WHERE migration_name = '<name>';
```

Before deploying, `npx prisma migrate status` must not report "modified after applied".
