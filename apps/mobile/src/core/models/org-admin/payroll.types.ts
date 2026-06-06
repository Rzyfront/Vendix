import type { ISODateString, MoneyAmount } from './common.types';

export interface PayrollEmployee {
  id: string;
  full_name: string;
  document_type: string;
  document_number: string;
  email?: string;
  phone?: string;
  position: string;
  department?: string;
  hire_date: ISODateString;
  termination_date?: ISODateString | null;
  base_salary: MoneyAmount;
  payment_frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  is_active: boolean;
  bank_account?: string;
  bank_name?: string;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface PayrollPeriod {
  id: string;
  name: string;
  year: number;
  month: number;
  start_date: ISODateString;
  end_date: ISODateString;
  payment_date: ISODateString;
  status: 'OPEN' | 'PROCESSING' | 'PAID' | 'CLOSED';
  total_employees: number;
  total_gross: MoneyAmount;
  total_deductions: MoneyAmount;
  total_net: MoneyAmount;
  total_provisions: MoneyAmount;
  processed_at?: ISODateString;
  created_at: ISODateString;
}

export interface PayrollProvision {
  id: string;
  period_id: string;
  type: 'CESANTIAS' | 'PRIMA' | 'VACACIONES' | 'INTERESES_CESANTIAS' | 'SALUD' | 'PENSION' | 'ARL' | 'CAJA_COMPENSACION' | 'ICBF' | 'SENA';
  employee_count: number;
  total_amount: MoneyAmount;
  calculation_date: ISODateString;
  notes?: string;
}

export interface PayrollSettings {
  organization_id: string;
  default_payment_frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  default_cutoff_day?: number;
  default_payment_day?: number;
  smlv_value?: MoneyAmount;
  transport_allowance?: MoneyAmount;
  aux_transport_applies_above?: number;
  health_provider?: string;
  pension_provider?: string;
  arl_provider?: string;
  caja_compensacion?: string;
  parafiscales_enabled: boolean;
  updated_at: ISODateString;
}
