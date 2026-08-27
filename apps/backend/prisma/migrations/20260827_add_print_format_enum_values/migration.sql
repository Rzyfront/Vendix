-- DATA IMPACT:
-- Tables affected: pg_type (print_format_type_enum)
-- Expected row changes: 0 rows migrated; pg_enum values 11 -> 15.
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: guarded by ADD VALUE IF NOT EXISTS (safe on re-run).
-- Approval: documented in [print-editor-dsk P8].
--
-- [print-editor-dsk P8] — Cuatro nuevos formatos para el Hub de impresión:
--   - dispatch_route             → planilla de ruta DSD
--   - withholding_practiced      → certificado de retención practicada
--   - withholding_suffered       → certificado de retención sufrida
--   - withholding_employee_certificate → certificado laboral de retención
--
-- pg_enum ADD VALUE no es destructivo y el IF NOT EXISTS hace la migración
-- idempotente — re-correrla en una DB que ya tenga los valores no falla.
-- Una vez en Postgres, `prisma generate` materializará los literales en
-- @prisma/client; mientras tanto, los providers usan el cast explícito
-- `'X' as unknown as print_format_type_enum` para mantener tsc verde, igual
-- que ya hicimos con `dispatch_ticket` en CP-DTLP-20260827.
--
-- Reversibilidad: pg_enum ADD VALUE NO se puede deshacer (es append-only);
-- revertir implica crear un enum nuevo y migrar TODAS las columnas que lo
-- usan. Documentado como knowledge gap.
ALTER TYPE "print_format_type_enum" ADD VALUE IF NOT EXISTS 'dispatch_route';
ALTER TYPE "print_format_type_enum" ADD VALUE IF NOT EXISTS 'withholding_practiced';
ALTER TYPE "print_format_type_enum" ADD VALUE IF NOT EXISTS 'withholding_suffered';
ALTER TYPE "print_format_type_enum" ADD VALUE IF NOT EXISTS 'withholding_employee_certificate';