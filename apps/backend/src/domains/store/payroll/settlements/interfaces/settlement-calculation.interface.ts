export interface SettlementCalculation {
  days_worked: number;
  days_in_semester: number;
  severance: number;
  severance_interest: number;
  bonus: number;
  vacation: number;
  pending_salary: number;
  indemnification: number;
  gross_settlement: number;
  health_deduction: number;
  pension_deduction: number;
  total_deductions: number;
  net_settlement: number;
  detail: Record<string, any>;
}
