-- =====================================================
-- M10: fix_fiscal_period_guard_delete_return
-- =====================================================
-- DATA IMPACT: NONE (function body only, no rows affected)
-- Purpose: corrige bug (5) de fn_block_closed_fiscal_period(), descubierto por
--          el agente A5 al intentar limpiar fixtures de prueba: la función
--          termina siempre con `RETURN NEW;`. Para TG_OP='DELETE', NEW es NULL
--          (no existe fila nueva en un delete) — un trigger BEFORE que retorna
--          NULL hace que Postgres OMITA la operación para esa fila SIN lanzar
--          error ("0 rows affected", sin excepción). Efecto real: todo DELETE
--          sobre accounting_entries/accounting_entry_lines queda bloqueado
--          silenciosamente, incluso en período ABIERTO o con el bypass GUC
--          `vendix.allow_closed_period='on'` activo — el guard nunca debía
--          tocar esos casos, pero el `RETURN NEW` incondicional los interceptó
--          igual.
--          Fix: retornar OLD cuando TG_OP='DELETE', NEW en cualquier otro caso.
--          Esto es aditivo/no-destructivo: no cambia qué se bloquea, solo dejó
--          de bloquear DELETEs que ya deberían pasar (período abierto o bypass).
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: CREATE OR REPLACE FUNCTION es idempotente por diseño
-- =====================================================

CREATE OR REPLACE FUNCTION fn_block_closed_fiscal_period() RETURNS TRIGGER AS $$
DECLARE
  v_fiscal_period_id INT;
  v_period RECORD;
  v_allow BOOLEAN;
BEGIN
  -- Bypass explícito
  v_allow := COALESCE(current_setting('vendix.allow_closed_period', TRUE), 'off');
  IF v_allow = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- Resolver el período real del asiento vía FK (nunca por rango de fechas:
  -- ver bug 4 de M9). accounting_entries.fiscal_period_id es NOT NULL.
  IF TG_TABLE_NAME = 'accounting_entries' THEN
    IF TG_OP = 'DELETE' THEN
      v_fiscal_period_id := OLD.fiscal_period_id;
    ELSE
      v_fiscal_period_id := NEW.fiscal_period_id;
    END IF;
  ELSE
    -- accounting_entry_lines: heredar el período del entry padre
    IF TG_OP = 'DELETE' THEN
      SELECT fiscal_period_id INTO v_fiscal_period_id
      FROM accounting_entries WHERE id = OLD.entry_id;
    ELSE
      SELECT fiscal_period_id INTO v_fiscal_period_id
      FROM accounting_entries WHERE id = NEW.entry_id;
    END IF;
  END IF;

  SELECT * INTO v_period
  FROM fiscal_periods
  WHERE id = v_fiscal_period_id
    AND status = 'closed';

  IF FOUND THEN
    -- UPDATE en accounting_entry_lines: permitir tocar columnas third_party_*.
    -- Anidado en un IF propio de la tabla: NEW.third_party_id solo se resuelve
    -- cuando el disparo es realmente sobre accounting_entry_lines.
    IF TG_TABLE_NAME = 'accounting_entry_lines' THEN
      IF TG_OP = 'UPDATE'
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
    END IF;

    RAISE EXCEPTION
      'fiscal_period_closed: cannot modify accounting data in closed period % (id=%)',
      v_period.start_date, v_period.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Bug (5): NEW es NULL en TG_OP='DELETE'; retornar NEW aquí incondicionalmente
  -- hacía que Postgres cancelara el DELETE en silencio (0 filas, sin excepción).
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
