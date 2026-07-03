-- =====================================================
-- M5: add_employee_fiscal_profiles
-- =====================================================
-- DATA IMPACT: NONE (schema only)
-- Purpose: Perfil tributario anual del empleado (1:1) con deducciones art. 387
--          ET (dependientes, intereses vivienda, medicina prepagada, pensión
--          voluntaria, AFC) y Procedimiento 2 art. 386 ET (porcentaje fijo
--          semestral persistido).
--          Tabla aparte (no columnas en employees) para evitar NULLs masivos
--          y permitir historización futura por año gravable.
-- =====================================================

CREATE TYPE retention_procedure_enum AS ENUM ('proc1', 'proc2');

CREATE TABLE IF NOT EXISTS employee_fiscal_profiles (
  id                              SERIAL PRIMARY KEY,
  employee_id                     INTEGER NOT NULL UNIQUE
                                  REFERENCES employees(id) ON DELETE CASCADE,
  organization_id                 INTEGER NOT NULL
                                  REFERENCES organizations(id) ON DELETE CASCADE,
  certificate_year                INTEGER NOT NULL,
  dependents_count                INTEGER NOT NULL DEFAULT 0,
  housing_interest_monthly        NUMERIC(12, 2) NOT NULL DEFAULT 0,
  prepaid_medicine_monthly        NUMERIC(12, 2) NOT NULL DEFAULT 0,
  voluntary_pension_monthly       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  afc_monthly                     NUMERIC(12, 2) NOT NULL DEFAULT 0,
  retention_procedure             retention_procedure_enum NOT NULL DEFAULT 'proc1',
  fixed_retention_rate            NUMERIC(5, 2),
  rate_semester                   VARCHAR(7),
  last_calculated_at              TIMESTAMP,
  created_at                      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT employee_fiscal_profiles_rate_semester_chk
    CHECK (rate_semester IS NULL OR rate_semester ~ '^\d{4}-[12]$'),
  CONSTRAINT employee_fiscal_profiles_fixed_rate_chk
    CHECK (fixed_retention_rate IS NULL OR (fixed_retention_rate >= 0 AND fixed_retention_rate <= 100)),
  CONSTRAINT employee_fiscal_profiles_procedure_rate_chk
    CHECK (
      (retention_procedure = 'proc1' AND fixed_retention_rate IS NULL)
      OR retention_procedure = 'proc2'
    )
);

CREATE INDEX IF NOT EXISTS employee_fiscal_profiles_org_idx
  ON employee_fiscal_profiles(organization_id);

CREATE INDEX IF NOT EXISTS employee_fiscal_profiles_year_idx
  ON employee_fiscal_profiles(certificate_year);