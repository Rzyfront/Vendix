-- =====================================================
-- M3: add_fiscal_location_ciiu_fields
-- =====================================================
-- DATA IMPACT: NONE (schema only)
-- Purpose: ICA se declara en el municipio de la TIENDA (código DANE) con CIIU
--          en cascada store→org. Habilita también la captura en fiscal-identity-panel.
-- =====================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS municipality_code  VARCHAR(10),
  ADD COLUMN IF NOT EXISTS department_code   VARCHAR(10),
  ADD COLUMN IF NOT EXISTS ciiu_code          VARCHAR(10);

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS ciiu_code          VARCHAR(10);

CREATE INDEX IF NOT EXISTS stores_municipality_idx
  ON stores(municipality_code)
  WHERE municipality_code IS NOT NULL;