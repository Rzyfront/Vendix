-- =====================================================
-- M9: fix_fiscal_period_closed_guard_trigger_columns
-- =====================================================
-- DATA IMPACT: NONE (function body only, no rows affected)
-- Purpose: corrige 2 bugs de M8 (20260702100008) en fn_block_closed_fiscal_period():
--          (1) consultaba fiscal_periods.period_start/period_end, columnas que
--              NO existen en la tabla real (son start_date/end_date). Bloqueaba
--              TODO insert/update en accounting_entries y accounting_entry_lines
--              con "column period_start does not exist" (motor contable entero caído).
--          (2) `IF v_period IS NOT NULL THEN` sobre un RECORD nunca es true si
--              CUALQUIER columna del período es NULL (semántica ROW del estándar
--              SQL: fiscal_periods.closed_by_user_id/accounting_entity_id son
--              nullable) → el guard jamás bloqueaba nada aun con las columnas
--              correctas. Fix: usar la variable especial `FOUND` de plpgsql,
--              que refleja si el SELECT INTO encontró fila, no si el RECORD
--              resultante tiene todas sus columnas no-nulas.
--          (3) `NEW.third_party_id` (y hermanos) referenciados dentro de un
--              único IF booleano compuesto junto a `TG_TABLE_NAME =
--              'accounting_entry_lines'`: PL/pgSQL resuelve el campo contra
--              el tipo de fila real de NEW en CADA disparo (bound vía
--              TG_RELID) y NO hace short-circuit de esa resolución a nivel
--              de expresión, aunque el AND sí cortocircuite valores en
--              tiempo de ejecución. Al disparar sobre `accounting_entries`
--              (sin columnas third_party_*), la sola presencia de
--              `NEW.third_party_id` en la expresión revienta con
--              "record \"new\" has no field \"third_party_id\"" sin importar
--              que `TG_TABLE_NAME = 'accounting_entry_lines'` sea falso.
--              Fix: anidar el chequeo en un IF/END IF propio, exclusivo de
--              la rama accounting_entry_lines — el control de flujo de
--              sentencias SÍ omite por completo las no alcanzadas (a
--              diferencia de un único booleano compuesto).
--          (4) La búsqueda de período por rango de fechas NO filtraba por
--              organization_id/accounting_entity_id: `SELECT * FROM
--              fiscal_periods WHERE start_date<=fecha AND end_date>=fecha
--              AND status='closed'` encuentra el período CERRADO de
--              CUALQUIER organización cuyo rango de fechas se solape con la
--              fecha del asiento — y como los períodos son casi siempre
--              mensuales/calendario, esto es la norma, no la excepción
--              (ej.: org 6 cierra 2026-01; cualquier OTRA org que intente
--              insertar un asiento en enero-2026 queda bloqueada aunque su
--              propio período de enero siga abierto). Fix de raíz: dejar de
--              reconstruir el período por rango de fechas y resolverlo por
--              la FK real `accounting_entries.fiscal_period_id` (NOT NULL),
--              que ya identifica sin ambigüedad a qué período pertenece
--              cada asiento — elimina la búsqueda por fecha por completo.
--              Para accounting_entry_lines se hereda vía `entry_id`. Esto
--              también corrige el caso DELETE (TG_OP='DELETE'), donde NEW
--              no existe: la versión anterior referenciaba NEW.entry_date
--              incondicionalmente fuera de la rama INSERT.
--          M8 ya fue aplicada y commiteada en dev; se corrige con una
--          migración correctiva nueva (CREATE OR REPLACE) en vez de editar
--          el archivo ya aplicado, para no invalidar el checksum registrado
--          en _prisma_migrations. (Esta propia migración M9 fue creada y
--          aplicada en el mismo turno, sin commitear — los bugs (2), (3) y
--          (4) se corrigieron en el archivo in-place, sin crear M10/M11,
--          por ser dev-only y de la misma operación de arreglo.)
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
    RETURN NEW;
  END IF;

  -- Resolver el período real del asiento vía FK (nunca por rango de fechas:
  -- ver bug 4 en el header). accounting_entries.fiscal_period_id es NOT NULL.
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
    -- cuando el disparo es realmente sobre accounting_entry_lines (ver bug 3
    -- en el header de esta migración).
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
