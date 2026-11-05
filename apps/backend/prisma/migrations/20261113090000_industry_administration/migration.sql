-- flujos-documental S1: industria `administration` (Flujos y Documentos).
-- Aditiva e idempotente. Sin mutación de filas: no requiere DATA IMPACT.
ALTER TYPE "industry_enum" ADD VALUE IF NOT EXISTS 'administration';
