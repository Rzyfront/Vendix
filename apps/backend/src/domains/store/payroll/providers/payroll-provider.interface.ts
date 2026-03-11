/**
 * Payroll provider adapter interface for DIAN electronic payroll (DSPNE).
 */

export const PAYROLL_PROVIDER = 'PAYROLL_PROVIDER';

export interface PayrollProviderResponse {
  success: boolean;
  tracking_id: string;
  cune?: string;
  xml_document?: string;
  message?: string;
  raw_response?: Record<string, any>;
}

export interface PayrollStatusResponse {
  tracking_id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'error';
  cune?: string;
  message?: string;
  raw_response?: Record<string, any>;
}

export interface PayrollProviderAdapter {
  /**
   * Send payroll document (DSPNE) to DIAN.
   */
  sendPayroll(payroll_data: {
    payroll_run_id: number;
    payroll_number: string;
    period_start: Date;
    period_end: Date;
    items: Array<{
      employee_id: number;
      employee_code: string;
      document_type: string;
      document_number: string;
      first_name: string;
      last_name: string;
      base_salary: number;
      worked_days: number;
      earnings: Record<string, any>;
      deductions: Record<string, any>;
      employer_costs: Record<string, any>;
      net_pay: number;
    }>;
  }): Promise<PayrollProviderResponse>;

  /**
   * Check the status of a previously sent payroll document.
   */
  checkStatus(tracking_id: string): Promise<PayrollStatusResponse>;
}
