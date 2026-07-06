/**
 * Novedades PILA del período (flags por empleado). Se derivan de
 * payroll_novelties aplicadas en los runs del mes y de las fechas del
 * contrato (ingreso/retiro) y de la variación de salario entre períodos.
 *
 * Mapeo a las novedades del archivo tipo 2 (Res. 2388/2016):
 * - ingreso                    -> ING (campo 15)
 * - retiro                     -> RET (campo 16)
 * - salary_variation_permanent -> VSP (campo 21)
 * - salary_variation_transitory-> VST (campo 23)
 * - unpaid_leave               -> SLN (campo 24)
 * - incapacity_general         -> IGE (campo 25)
 * - maternity_leave            -> LMA (campo 26)
 * - vacation                   -> VAC-LR (campo 27)
 * - incapacity_laboral         -> IRL (campo 30, en días)
 */
export interface PilaNoveltyFlags {
  vacation: boolean;
  incapacity_general: boolean;
  incapacity_laboral: boolean;
  unpaid_leave: boolean;
  /** ING: alta del empleado dentro del período (hire_date en el mes). */
  ingreso: boolean;
  /** RET: retiro del empleado dentro del período (termination_date en el mes). */
  retiro: boolean;
  /** VSP: cambio permanente de salario respecto del período anterior. */
  salary_variation_permanent: boolean;
  /** VST: variación transitoria del salario (sin fuente actual, reservado). */
  salary_variation_transitory: boolean;
  /** LMA: licencia de maternidad/paternidad aplicada en el período. */
  maternity_leave: boolean;
}

/** Rango de fechas de una novedad (formato ISO 'AAAA-MM-DD'). */
export interface PilaNoveltyDateRange {
  start: string | null;
  end: string | null;
}

/**
 * Fechas de novedad por empleado para el archivo plano PILA. Alimentan los
 * campos 80-94 del registro tipo 2 (fechas inicio/fin de cada novedad).
 */
export interface PilaNoveltyDates {
  ingreso: string | null;
  retiro: string | null;
  incapacity_general: PilaNoveltyDateRange;
  maternity_leave: PilaNoveltyDateRange;
  vacation: PilaNoveltyDateRange;
  incapacity_laboral: PilaNoveltyDateRange;
  unpaid_leave: PilaNoveltyDateRange;
  salary_variation_permanent_start: string | null;
}

/**
 * Aportes de seguridad social y parafiscales de un empleado para un
 * período PILA (año/mes).
 */
export interface PilaEmployeeContribution {
  employee_id: number;
  document_type: string;
  document_number: string;
  full_name: string;
  /** Nombre(s) del empleado (para desglose primer/segundo nombre en archivo). */
  first_name: string;
  /** Apellido(s) del empleado (para desglose primer/segundo apellido). */
  last_name: string;
  /** Tipo de salario del contrato (ordinario / integral). */
  salary_type: 'ordinary' | 'integral';
  /** Salario básico contratado (para el campo 40 del registro tipo 2). */
  base_salary: number;
  /**
   * Ingreso Base de Cotización YA TOPADO: entre piso 1 SMMLV (prorrateado por
   * días cotizados) y techo 25 SMMLV. Salario + devengos salariales, SIN
   * subsidio de transporte.
   */
  ibc: number;
  worked_days: number;
  arl_risk_level: number | null;
  health_employee: number;
  health_employer: number;
  pension_employee: number;
  pension_employer: number;
  arl: number;
  sena: number;
  icbf: number;
  compensation_fund: number;
  /**
   * Cotizante exonerado de aportes patronales de salud, SENA e ICBF
   * (Ley 1607/2012 art. 25 / Ley 1819/2016). Derivado: aplica cuando el IBC
   * es inferior a 10 SMMLV y no se liquidaron SENA/ICBF patronales.
   */
  exonerated: boolean;
  /** Días de incapacidad por accidente/enfermedad laboral (campo 30 IRL). */
  irl_days: number;
  novelty_flags: PilaNoveltyFlags;
  /** Fechas de novedad para los campos 80-94 del registro tipo 2. */
  novelty_dates: PilaNoveltyDates;
  /** Suma de todos los aportes (empleado + empleador + parafiscales). */
  total: number;
}

/** Totales agregados del período (mismos conceptos que cada empleado). */
export interface PilaPeriodTotals {
  ibc: number;
  health_employee: number;
  health_employer: number;
  pension_employee: number;
  pension_employer: number;
  arl: number;
  sena: number;
  icbf: number;
  compensation_fund: number;
  total: number;
}

export interface PilaPeriodReport {
  year: number;
  month: number;
  employees: PilaEmployeeContribution[];
  totals: PilaPeriodTotals;
}

export interface PilaCsvExport {
  filename: string;
  content: string;
}

/**
 * Archivo plano oficial PILA (Res. 2388/2016) listo para pago por operador
 * (SOI / Aportes en Línea). `content` es un registro tipo 1 (encabezado)
 * seguido de un registro tipo 2 por cotizante, separados por CRLF.
 */
export interface PilaFlatFileResult {
  filename: string;
  content: string;
  /** Número de cotizantes (registros tipo 2) incluidos. */
  cotizantes: number;
}

/**
 * Fila de tracking de una generación/exportación de planilla PILA
 * (tabla `pila_submissions`). El CSV/archivo NO se persiste — es
 * regenerable determinísticamente a partir de payroll_items/novelties.
 */
export interface PilaSubmissionRecord {
  id: number;
  organization_id: number;
  accounting_entity_id: number;
  period_year: number;
  period_month: number;
  status: 'generated' | 'exported' | 'void';
  employees_count: number;
  total_earnings: string;
  total_contributions: string;
  metadata: Record<string, unknown> | null;
  exported_at: string | null;
  exported_by_user_id: number | null;
  voided_at: string | null;
  voided_by_user_id: number | null;
  void_reason: string | null;
  created_by_user_id: number | null;
  created_at: string | null;
  updated_at: string | null;
}
