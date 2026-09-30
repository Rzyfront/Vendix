-- QUI-855: fiscal classification of purchase taxes (ICUI, IBUA).
-- DATA IMPACT: none (enum values only). Idempotent.
-- Values are only ADDED here and never used in this migration; usage lives in
-- application code, so no same-transaction enum-usage problem.
ALTER TYPE "tax_type_enum" ADD VALUE IF NOT EXISTS 'icui';
ALTER TYPE "tax_type_enum" ADD VALUE IF NOT EXISTS 'ibua';
