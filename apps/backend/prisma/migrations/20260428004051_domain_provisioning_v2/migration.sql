-- DATA IMPACT:
--   EXTENSION: instala pgcrypto si no existe (idempotente, requerida por gen_random_bytes() en part2)
--   ENUMs: añade 9 valores a domain_status_enum (no destructivo)
-- DESTRUCTIVE: NONE
-- IDEMPOTENT: SI — IF NOT EXISTS en todo
-- SPLIT-NOTE: parte 1/2 — Postgres rechaza usar valores nuevos de enum en la misma transacción
--             en que se agregan (SQLSTATE 55P04). Cada migración Prisma corre en su propia tx,
--             así que los ADD VALUE de aquí quedan committeados antes de que part2 los use.

-- Required extension. Self-declared aquí (en lugar de en una migración inicial
-- que prod ya aplicó) porque part2 es la primera migración del repo en usar
-- gen_random_bytes(). Idempotente: noop si ya está instalada.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 7.1 Nuevos valores de enum (idempotente)
ALTER TYPE "domain_status_enum" ADD VALUE IF NOT EXISTS 'pending_ownership';
ALTER TYPE "domain_status_enum" ADD VALUE IF NOT EXISTS 'verifying_ownership';
ALTER TYPE "domain_status_enum" ADD VALUE IF NOT EXISTS 'pending_certificate';
ALTER TYPE "domain_status_enum" ADD VALUE IF NOT EXISTS 'issuing_certificate';
ALTER TYPE "domain_status_enum" ADD VALUE IF NOT EXISTS 'pending_alias';
ALTER TYPE "domain_status_enum" ADD VALUE IF NOT EXISTS 'propagating';
ALTER TYPE "domain_status_enum" ADD VALUE IF NOT EXISTS 'failed_ownership';
ALTER TYPE "domain_status_enum" ADD VALUE IF NOT EXISTS 'failed_certificate';
ALTER TYPE "domain_status_enum" ADD VALUE IF NOT EXISTS 'failed_alias';
