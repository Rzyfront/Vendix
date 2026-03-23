import { Injectable } from '@nestjs/common';
import { PayrollRules } from '../calculation/interfaces/payroll-rules.interface';
import { SettlementCalculation } from './interfaces/settlement-calculation.interface';

interface SettlementCalculationParams {
  base_salary: number;
  hire_date: Date;
  termination_date: Date;
  termination_reason: string;
  contract_type: string;
  rules: PayrollRules;
  pending_salary_days?: number;
  contract_end_date?: Date;
}

@Injectable()
export class SettlementCalculationService {
  /**
   * Calculate full settlement for an employee based on Colombian labor law.
   */
  calculateSettlement(params: SettlementCalculationParams): SettlementCalculation {
    const {
      base_salary,
      hire_date,
      termination_date,
      termination_reason,
      contract_type,
      rules,
      pending_salary_days = 0,
      contract_end_date,
    } = params;

    const days_worked = this.calculateWorkedDays360(hire_date, termination_date);

    // Cesantias = (salario x dias_trabajados) / 360
    const severance = this.round((base_salary * days_worked) / 360);

    // Intereses de cesantias = (cesantias x 0.12 x dias_en_anio) / 360
    // dias_en_anio = days from Jan 1 (or hire_date if hired this year) to termination_date
    const year_start = new Date(termination_date.getFullYear(), 0, 1);
    const interest_start = hire_date > year_start ? hire_date : year_start;
    const days_in_year = this.calculateWorkedDays360(interest_start, termination_date);
    const severance_interest = this.round(
      (severance * rules.severance_interest_rate * days_in_year) / 360,
    );

    // Prima proporcional = (salario x dias_semestre) / 360
    // dias_semestre = days from Jan 1 or Jul 1 to termination_date
    const days_in_semester = this.calculateDaysInSemester(hire_date, termination_date);
    const bonus = this.round((base_salary * days_in_semester) / 360);

    // Vacaciones proporcionales = (salario_base x dias_trabajados) / 720
    const vacation = this.round((base_salary * days_worked) / 720);

    // Pending salary = (salario / 30) x pending_salary_days
    const pending_salary = this.round((base_salary / 30) * pending_salary_days);

    // Indemnification (Art. 64 CST) - only for without_just_cause
    const indemnification = this.calculateIndemnification(
      base_salary,
      hire_date,
      termination_date,
      termination_reason,
      contract_type,
      rules,
      contract_end_date,
    );

    const gross_settlement = this.round(
      severance + severance_interest + bonus + vacation + pending_salary + indemnification,
    );

    // Deductions on gross (excluding indemnification for social security)
    const deductible_base = this.round(
      severance + severance_interest + bonus + vacation + pending_salary,
    );
    const health_deduction = this.round(deductible_base * rules.health_employee_rate);
    const pension_deduction = this.round(deductible_base * rules.pension_employee_rate);
    const total_deductions = this.round(health_deduction + pension_deduction);

    const net_settlement = this.round(gross_settlement - total_deductions);

    return {
      days_worked,
      days_in_semester,
      severance,
      severance_interest,
      bonus,
      vacation,
      pending_salary,
      indemnification,
      gross_settlement,
      health_deduction,
      pension_deduction,
      total_deductions,
      net_settlement,
      detail: {
        base_salary,
        hire_date: hire_date.toISOString(),
        termination_date: termination_date.toISOString(),
        termination_reason,
        contract_type,
        days_in_year,
        days_in_semester,
        pending_salary_days,
        deductible_base,
        health_rate: rules.health_employee_rate,
        pension_rate: rules.pension_employee_rate,
      },
    };
  }

  /**
   * Calculate indemnification per Art. 64 CST.
   * Only applies when termination_reason is 'without_just_cause'.
   */
  private calculateIndemnification(
    base_salary: number,
    hire_date: Date,
    termination_date: Date,
    termination_reason: string,
    contract_type: string,
    rules: PayrollRules,
    contract_end_date?: Date,
  ): number {
    if (termination_reason !== 'without_just_cause') {
      return 0;
    }

    const daily_salary = base_salary / 30;

    // Fixed term: salary for remaining contract days
    if (contract_type === 'fixed_term' && contract_end_date) {
      const remaining_days = this.calculateWorkedDays360(termination_date, contract_end_date);
      return this.round(daily_salary * remaining_days);
    }

    // Indefinite contract
    const total_days_worked = this.calculateWorkedDays360(hire_date, termination_date);
    const years_worked = total_days_worked / 360;
    const is_high_salary = base_salary > rules.minimum_wage * 10;

    if (is_high_salary) {
      // > 10 SMLMV: 20 days first year + 15 days per additional year
      const first_year_days = 20;
      const additional_years = Math.max(years_worked - 1, 0);
      const additional_days = Math.ceil(additional_years) * 15;
      return this.round(daily_salary * (first_year_days + additional_days));
    } else {
      // <= 10 SMLMV: 30 days first year + 20 days per additional year
      const first_year_days = 30;
      const additional_years = Math.max(years_worked - 1, 0);
      const additional_days = Math.ceil(additional_years) * 20;
      return this.round(daily_salary * (first_year_days + additional_days));
    }
  }

  /**
   * Calculate days in current semester for bonus (prima) calculation.
   * Semester 1: Jan 1 - Jun 30, Semester 2: Jul 1 - Dec 31.
   * If employee was hired mid-semester, use hire_date as start.
   */
  private calculateDaysInSemester(hire_date: Date, termination_date: Date): number {
    const month = termination_date.getMonth();
    const year = termination_date.getFullYear();
    const semester_start = month < 6
      ? new Date(year, 0, 1)   // Jan 1
      : new Date(year, 6, 1);  // Jul 1

    const effective_start = hire_date > semester_start ? hire_date : semester_start;
    return this.calculateWorkedDays360(effective_start, termination_date);
  }

  /**
   * Calculate worked days between two dates using Colombian 30/360 standard.
   */
  private calculateWorkedDays360(start: Date, end: Date): number {
    const s = new Date(start);
    const e = new Date(end);

    const start_year = s.getFullYear();
    const start_month = s.getMonth();
    const start_day = Math.min(s.getDate(), 30);

    const end_year = e.getFullYear();
    const end_month = e.getMonth();
    const end_day = Math.min(e.getDate(), 30);

    const days =
      (end_year - start_year) * 360 +
      (end_month - start_month) * 30 +
      (end_day - start_day) +
      1; // inclusive

    return Math.max(days, 1);
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
