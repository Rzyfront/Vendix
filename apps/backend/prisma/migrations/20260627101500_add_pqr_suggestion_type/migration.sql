-- =====================================================================
-- Add 'SUGGESTION' to ticket_category_enum
-- =====================================================================
-- Extends the PQR category set with a fourth option so the public
-- form, admin filters, and stats breakdowns can distinguish
-- "Sugerencia" from "Petición". The acronym P,Q,R,S is now
-- intentional and matches the visible UI rename.
--
-- The enum itself lives in Postgres as ticket_category_enum (not
-- pqr_type_enum) because the same enum is shared by all support
-- tickets — only PETITION / COMPLAINT / CLAIM / SUGGESTION are
-- considered PQR-shaped per the legacy tag-based filter.
--
-- Idempotent via ADD VALUE IF NOT EXISTS (PG 12+) so re-running the
-- migration after a partial failure is safe.
-- =====================================================================

-- AlterEnum
ALTER TYPE "ticket_category_enum" ADD VALUE IF NOT EXISTS 'SUGGESTION';