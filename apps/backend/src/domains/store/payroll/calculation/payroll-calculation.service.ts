import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { PayrollRules } from './interfaces/payroll-rules.interface';

interface EmployeeCalculationInput {
  id: number;
  base_salary: Prisma.Decimal;
  arl_risk_level: number | null;
}

interface EarningsBreakdown {
  base_salary: number;
  transport_subsidy: number;
  total: number;
}

interface DeductionsBreakdown {
  health: number;
  pension: number;
  retention: number;
  total: number;
}

interface EmployerCostsBreakdown {
  health: number;
  pension: number;
  arl: number;
  sena: number;
  icbf: number;
  compensation_fund: number;
  total: number;
}

export interface PayrollItemCalculation {
  employee_id: number;
  base_salary: number;
  worked_days: number;
  earnings: EarningsBreakdown;
  deductions: DeductionsBreakdown;
  employer_costs: EmployerCostsBreakdown;
  total_earnings: number;
  total_deductions: number;
  total_employer_costs: number;
  net_pay: number;
}

@Injectable()
export class PayrollCalculationService {
  private readonly logger = new Logger(PayrollCalculationService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Calculate payroll for all active employees within the given context.
   */
  async calculateForRun(
    payroll_run_id: number,
    period_start: Date,
    period_end: Date,
    store_id: number | null,
    rules: PayrollRules,
  ): Promise<PayrollItemCalculation[]> {
    const where: Prisma.employeesWhereInput = {
      status: 'active',
      hire_date: { lte: period_end },
      ...(store_id && { store_id }),
    };

    const employees = await this.prisma.employees.findMany({ where });

    if (employees.length === 0) {
      throw new VendixHttpException(ErrorCodes.PAYROLL_CALC_001);
    }

    const worked_days = this.calculateWorkedDays(period_start, period_end);
    const calculations: PayrollItemCalculation[] = [];

    for (const employee of employees) {
      const calc = this.calculateEmployeePayroll(
        {
          id: employee.id,
          base_salary: employee.base_salary,
          arl_risk_level: employee.arl_risk_level,
        },
        worked_days,
        rules,
      );
      calculations.push(calc);
    }

    // Persist payroll items in a transaction
    await this.prisma.$transaction(async (tx: any) => {
      // Delete existing items for this run (recalculation scenario)
      await tx.payroll_items.deleteMany({
        where: { payroll_run_id },
      });

      // Create new items
      for (const calc of calculations) {
        await tx.payroll_items.create({
          data: {
            payroll_run_id,
            employee_id: calc.employee_id,
            base_salary: new Prisma.Decimal(calc.base_salary),
            worked_days: calc.worked_days,
            earnings: calc.earnings as any,
            deductions: calc.deductions as any,
            employer_costs: calc.employer_costs as any,
            total_earnings: new Prisma.Decimal(calc.total_earnings),
            total_deductions: new Prisma.Decimal(calc.total_deductions),
            total_employer_costs: new Prisma.Decimal(calc.total_employer_costs),
            net_pay: new Prisma.Decimal(calc.net_pay),
          },
        });
      }

      // Update payroll run totals
      const total_earnings = calculations.reduce((sum, c) => sum + c.total_earnings, 0);
      const total_deductions = calculations.reduce((sum, c) => sum + c.total_deductions, 0);
      const total_employer_costs = calculations.reduce((sum, c) => sum + c.total_employer_costs, 0);
      const total_net_pay = calculations.reduce((sum, c) => sum + c.net_pay, 0);

      await tx.payroll_runs.update({
        where: { id: payroll_run_id },
        data: {
          status: 'calculated',
          total_earnings: new Prisma.Decimal(this.round(total_earnings)),
          total_deductions: new Prisma.Decimal(this.round(total_deductions)),
          total_employer_costs: new Prisma.Decimal(this.round(total_employer_costs)),
          total_net_pay: new Prisma.Decimal(this.round(total_net_pay)),
        },
      });
    });

    this.logger.log(
      `Calculated payroll run #${payroll_run_id}: ${calculations.length} employees, ` +
        `net_pay total: ${calculations.reduce((s, c) => s + c.net_pay, 0)}`,
    );

    return calculations;
  }

  /**
   * Pure calculation for a single employee.
   */
  calculateEmployeePayroll(
    employee: EmployeeCalculationInput,
    worked_days: number,
    rules: PayrollRules,
  ): PayrollItemCalculation {
    const salary = Number(employee.base_salary);
    const proportion = worked_days / rules.days_per_month;

    // Earnings
    const proportional_salary = this.round(salary * proportion);
    const qualifies_for_transport =
      salary <= rules.minimum_wage * rules.transport_subsidy_threshold;
    const transport_subsidy = qualifies_for_transport
      ? this.round(rules.transport_subsidy * proportion)
      : 0;
    const total_earnings = this.round(proportional_salary + transport_subsidy);

    // Deductions (employee portion) - calculated on salary, not on transport subsidy
    const health_deduction = this.round(proportional_salary * rules.health_employee_rate);
    const pension_deduction = this.round(proportional_salary * rules.pension_employee_rate);

    // Simplified retention: 0 if salary < threshold × min wage
    const retention =
      salary >= rules.minimum_wage * rules.retention_exempt_threshold
        ? this.round(proportional_salary * 0.01) // Simplified 1% for high earners
        : 0;
    const total_deductions = this.round(health_deduction + pension_deduction + retention);

    // Employer costs
    const arl_rate = rules.arl_rates[employee.arl_risk_level || 1] || rules.arl_rates[1];
    const health_employer = this.round(proportional_salary * rules.health_employer_rate);
    const pension_employer = this.round(proportional_salary * rules.pension_employer_rate);
    const arl_cost = this.round(proportional_salary * arl_rate);
    const sena_cost = this.round(proportional_salary * rules.sena_rate);
    const icbf_cost = this.round(proportional_salary * rules.icbf_rate);
    const compensation_fund_cost = this.round(proportional_salary * rules.compensation_fund_rate);
    const total_employer_costs = this.round(
      health_employer + pension_employer + arl_cost + sena_cost + icbf_cost + compensation_fund_cost,
    );

    const net_pay = this.round(total_earnings - total_deductions);

    return {
      employee_id: employee.id,
      base_salary: salary,
      worked_days,
      earnings: {
        base_salary: proportional_salary,
        transport_subsidy,
        total: total_earnings,
      },
      deductions: {
        health: health_deduction,
        pension: pension_deduction,
        retention,
        total: total_deductions,
      },
      employer_costs: {
        health: health_employer,
        pension: pension_employer,
        arl: arl_cost,
        sena: sena_cost,
        icbf: icbf_cost,
        compensation_fund: compensation_fund_cost,
        total: total_employer_costs,
      },
      total_earnings,
      total_deductions,
      total_employer_costs,
      net_pay,
    };
  }

  /**
   * Calculate worked days between two dates using Colombian 30-day month standard.
   */
  private calculateWorkedDays(period_start: Date, period_end: Date): number {
    const start = new Date(period_start);
    const end = new Date(period_end);

    const start_year = start.getFullYear();
    const start_month = start.getMonth();
    const start_day = Math.min(start.getDate(), 30);

    const end_year = end.getFullYear();
    const end_month = end.getMonth();
    const end_day = Math.min(end.getDate(), 30);

    const days =
      (end_year - start_year) * 360 +
      (end_month - start_month) * 30 +
      (end_day - start_day) +
      1; // inclusive

    return Math.min(Math.max(days, 1), 30);
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
