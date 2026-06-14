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
