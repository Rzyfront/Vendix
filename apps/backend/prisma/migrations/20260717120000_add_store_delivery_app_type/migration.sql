-- DATA IMPACT: none. Additive enum value. No backfill, no row lock.
-- Adds 'STORE_DELIVERY' to app_type_enum for Vendix Repartos (internal delivery
-- app_type for carrier role). Idempotent so re-applies after partial drift are
-- safe. Per `vendix-prisma-migrations` enum rule, the value is added here in a
-- dedicated migration; downstream migrations that USE the new value land in
-- later phases.

ALTER TYPE "app_type_enum" ADD VALUE IF NOT EXISTS 'STORE_DELIVERY';