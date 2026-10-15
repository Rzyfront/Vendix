-- DATA IMPACT: none (schema-only). Adds the 'initial_load' value to adjustment_type_enum.
-- Tables affected: none. Expected row changes: none. Destructive operations: none.
-- The new value is NOT used in this migration (Postgres enum rule).
ALTER TYPE "adjustment_type_enum" ADD VALUE IF NOT EXISTS 'initial_load';
