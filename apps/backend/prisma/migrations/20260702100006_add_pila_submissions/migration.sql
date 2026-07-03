-- =====================================================
-- M6: add_pila_submissions
-- =====================================================
-- DATA IMPACT: NONE (schema only)
-- Purpose: Tracking de planillas PILA generadas/exportadas/anuladas por
--          aportante (accounting_entity_id) y período. El CSV NO se persiste
--          en BD (regenerable determinísticamente); el control de duplicados
--          activos se hace en servicio, no vía UNIQUE en BD.
-- =====================================================

CREATE TYPE pila_submission_status_enum AS ENUM ('generated', 'exported', 'void');

CREATE TABLE IF NOT EXISTS pila_submissions (
  id                   SERIAL PRIMARY KEY,
  organization_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  accounting_entity_id INTEGER NOT NULL REFERENCES accounting_entities(id) ON DELETE RESTRICT,
  period_year          INTEGER NOT NULL,
  period_month         INTEGER NOT NULL,
  status               pila_submission_status_enum NOT NULL DEFAULT 'generated',
  employees_count      INTEGER NOT NULL DEFAULT 0,
  total_earnings       NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_contributions  NUMERIC(14, 2) NOT NULL DEFAULT 0,
  metadata             JSONB,
  exported_at          TIMESTAMP,
  exported_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  voided_at            TIMESTAMP,
  voided_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  void_reason          TEXT,
  created_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT pila_submissions_period_chk
    CHECK (period_month BETWEEN 1 AND 12 AND period_year BETWEEN 2000 AND 2100)
);

CREATE INDEX IF NOT EXISTS pila_submissions_entity_period_idx
  ON pila_submissions(accounting_entity_id, period_year, period_month);

CREATE INDEX IF NOT EXISTS pila_submissions_status_idx
  ON pila_submissions(status, period_year, period_month);