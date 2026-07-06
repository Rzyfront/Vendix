-- =====================================================
-- M1: add_third_party_to_accounting_entry_lines
-- =====================================================
-- DATA IMPACT: NONE (schema only)
-- Purpose: Snapshot legal del tercero (NIT/nombre) en cada línea de asiento.
--          Requisito legal exógena art. 631 ET: el NIT histórico NO debe mutar.
--          Se permiten NULL en líneas existentes; el backfill ocurre en M2.
-- =====================================================

ALTER TABLE accounting_entry_lines
  ADD COLUMN IF NOT EXISTS third_party_id     INTEGER,
  ADD COLUMN IF NOT EXISTS third_party_type   VARCHAR(40),
  ADD COLUMN IF NOT EXISTS third_party_name   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS third_party_tax_id VARCHAR(50);

CREATE INDEX IF NOT EXISTS accounting_entry_lines_third_party_tax_id_idx
  ON accounting_entry_lines(third_party_tax_id);

CREATE INDEX IF NOT EXISTS accounting_entry_lines_third_party_lookup_idx
  ON accounting_entry_lines(third_party_type, third_party_id);