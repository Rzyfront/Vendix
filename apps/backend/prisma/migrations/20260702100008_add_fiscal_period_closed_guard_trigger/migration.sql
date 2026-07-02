-- =====================================================
-- M8: add_fiscal_period_closed_guard_trigger
-- =====================================================
-- DATA IMPACT: NONE (schema only)
-- Purpose: Defensa en profundidad del período fiscal cerrado.
--          El guard de servicio (C2) marca failures como no-reintenables;
--          este trigger blinda la BASE DE DATOS — seeds, scripts y servicios
--          futuros no pueden violar la invariante.
-- Bypass: GUC `vendix.allow_closed_period = on` (uso admin explícito).
-- Permite UPDATE de columnas third_party_* (M1) en líneas cerradas (snapshot
-- puede corregirse retroactivamente sin reabrir el período).
-- Permite status='closing' (en transición approve→close).
-- =====================================================

CREATE OR REPLACE FUNCTION fn_block_closed_fiscal_period() RETURNS TRIGGER AS $$
DECLARE
  v_entry_date DATE;
  v_period RECORD;
  v_allow BOOLEAN;
BEGIN
  -- Bypass explícito
  v_allow := COALESCE(current_setting('vendix.allow_closed_period', TRUE), 'off');
  IF v_allow = 'on' THEN
    RETURN NEW;
  END IF;

  -- Determinar fecha del asiento: INSERT usa NEW.entry_date / NEW.created_at;
  -- UPDATE usa OLD.entry_date (no se permite cambiar fecha de un cerrado).
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'accounting_entries' THEN
      v_entry_date := COALESCE(NEW.entry_date, NEW.created_at)::date;
    ELSE
      -- accounting_entry_lines: tomar fecha del entry padre
      SELECT entry_date INTO v_entry_date
      FROM accounting_entries
      WHERE id = NEW.entry_id;
      v_entry_date := COALESCE(v_entry_date, NEW.created_at)::date;
    END IF;
  ELSE
    -- UPDATE: si la fecha cambia y el período destino está cerrado, bloquear
    IF TG_TABLE_NAME = 'accounting_entries' THEN
      v_entry_date := COALESCE(NEW.entry_date, OLD.entry_date)::date;
    ELSE
      SELECT entry_date INTO v_entry_date
      FROM accounting_entries
      WHERE id = NEW.entry_id;
      v_entry_date := COALESCE(v_entry_date, OLD.created_at)::date;
    END IF;
  END IF;

  -- Buscar período que cubra la fecha
  SELECT * INTO v_period
  FROM fiscal_periods
  WHERE period_start <= v_entry_date
    AND period_end >= v_entry_date
    AND status = 'closed'
  LIMIT 1;

  IF v_period IS NOT NULL THEN
    -- UPDATE en accounting_entry_lines: permitir tocar columnas third_party_*
    IF TG_OP = 'UPDATE'
       AND TG_TABLE_NAME = 'accounting_entry_lines'
       AND (NEW.third_party_id IS DISTINCT FROM OLD.third_party_id
         OR NEW.third_party_type IS DISTINCT FROM OLD.third_party_type
         OR NEW.third_party_name IS DISTINCT FROM OLD.third_party_name
         OR NEW.third_party_tax_id IS DISTINCT FROM OLD.third_party_tax_id)
       AND NEW.account_id = OLD.account_id
       AND NEW.debit_amount = OLD.debit_amount
       AND NEW.credit_amount = OLD.credit_amount
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'fiscal_period_closed: cannot modify accounting data in closed period % (id=%)',
      v_period.period_start, v_period.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_closed_fiscal_period_entries ON accounting_entries;
CREATE TRIGGER trg_block_closed_fiscal_period_entries
  BEFORE INSERT OR UPDATE OR DELETE ON accounting_entries
  FOR EACH ROW
  EXECUTE FUNCTION fn_block_closed_fiscal_period();

DROP TRIGGER IF EXISTS trg_block_closed_fiscal_period_lines ON accounting_entry_lines;
CREATE TRIGGER trg_block_closed_fiscal_period_lines
  BEFORE INSERT OR UPDATE OR DELETE ON accounting_entry_lines
  FOR EACH ROW
  EXECUTE FUNCTION fn_block_closed_fiscal_period();