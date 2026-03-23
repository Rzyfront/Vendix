/**
 * Interfaces for the data needed to build a DSPNE NominaIndividual XML.
 *
 * These represent the structured data that maps directly to XML elements
 * and attributes in the DIAN DSPNE specification.
 */

/** Employer (emisor) data for the <Empleador> element */
export interface NominaEmpleadorData {
  nit: string;
  dv: string;
  country: string;
  department: string;
  city: string;
  address: string;
  legal_name: string;
}

/** Worker (trabajador) data for the <Trabajador> element */
export interface NominaTrabajadorData {
  worker_type: string;
  sub_type: string;
  high_risk_pension: boolean;
  document_type: string;
  document_number: string;
  first_name: string;
  last_name: string;
  second_last_name?: string;
  other_names?: string;
  work_country: string;
  work_department: string;
  work_city: string;
  work_address: string;
  integral_salary: boolean;
  contract_type: string;
  salary: number;
  employee_code: string;
  hire_date: string;
  termination_date?: string;
}

/** Payment data for the <Pago> and <FechasPagos> elements */
export interface NominaPagoData {
  /** 1 = contado, 2 = credito */
  form: string;
  /** 10 = cash, 47 = bank_transfer, 20 = check */
  method: string;
  bank?: string;
  account_type?: string;
  account_number?: string;
  payment_dates: string[];
}

/** Earnings (devengados) data for the <Devengados> element */
export interface NominaDevengadosData {
  worked_days: number;
  base_salary: number;
  transport_subsidy?: number;
  travel_allowance_taxable?: number;
  travel_allowance_non_taxable?: number;
  /** Overtime and surcharges */
  overtime?: Array<{
    type: string;
    hours: number;
    percentage: number;
    amount: number;
  }>;
  /** Bonuses */
  bonuses?: Array<{
    taxable: number;
    non_taxable: number;
  }>;
  /** Commissions */
  commissions?: number;
  /** Prima de servicios */
  primas?: {
    quantity: number;
    payment: number;
    non_taxable_payment?: number;
  };
  /** Cesantias */
  cesantias?: {
    payment: number;
    percentage: number;
    interest_payment: number;
  };
  /** Vacaciones */
  vacations?: Array<{
    start_date: string;
    end_date: string;
    quantity: number;
    payment: number;
  }>;
  /** Incapacidades */
  disabilities?: Array<{
    start_date: string;
    end_date: string;
    quantity: number;
    type: number;
    payment: number;
  }>;
  /** Licencias */
  licenses?: Array<{
    start_date: string;
    end_date: string;
    quantity: number;
    type: string;
    payment: number;
  }>;
}

/** Deductions (deducciones) data for the <Deducciones> element */
export interface NominaDeduccionesData {
  health_pct: number;
  health_amount: number;
  pension_pct: number;
  pension_amount: number;
  solidarity_fund_pct?: number;
  solidarity_fund_amount?: number;
  subsistence_fund_pct?: number;
  subsistence_fund_amount?: number;
  retention?: number;
  /** Other deductions */
  other_deductions?: Array<{
    description: string;
    amount: number;
  }>;
}

/** Period data for the <Periodo> element */
export interface NominaPeriodoData {
  hire_date: string;
  settlement_start: string;
  settlement_end: string;
  worked_time: string;
  generation_date: string;
}

/** Location data for the <LugarGeneracionXML> element */
export interface NominaLocationData {
  country: string;
  department: string;
  city: string;
  language: string;
}

/**
 * Complete document data combining all sections.
 * This is the top-level input to NominaIndividualBuilder.build().
 */
export interface NominaDocumentData {
  prefix: string;
  consecutive: string;
  period: NominaPeriodoData;
  location: NominaLocationData;
  employer: NominaEmpleadorData;
  worker: NominaTrabajadorData;
  payment: NominaPagoData;
  earnings: NominaDevengadosData;
  deductions: NominaDeduccionesData;
  /** Total devengados (sum of all earnings) */
  total_earnings: number;
  /** Total deducciones (sum of all deductions) */
  total_deductions: number;
  /** Comprobante total = total_earnings - total_deductions */
  net_amount: number;
  /** Payroll period type: 1=Semanal, 2=Decenal, 3=Catorcenal, 4=Quincenal, 5=Mensual */
  payroll_period: string;
}
