/**
 * Novedades PILA del período (flags por empleado, derivados de
 * payroll_novelties aplicadas en los runs del mes).
 */
export interface PilaNoveltyFlags {
  vacation: boolean;
  incapacity_general: boolean;
  incapacity_laboral: boolean;
  unpaid_leave: boolean;
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
  /** Ingreso Base de Cotización: salario + devengos salariales, SIN subsidio de transporte. */
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
  novelty_flags: PilaNoveltyFlags;
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
