import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { PayrollRules } from './interfaces/payroll-rules.interface';
import { PayrollRulesService } from './payroll-rules.service';
import { AdvancesService } from '../advances/advances.service';
import { NoveltiesService } from '../novelties/novelties.service';
import { valuateNovelty, ValuatedNovelty } from './novelty-valuation';
import {
  calculateLaborWithholding,
  LaborWithholdingResult,
} from './retefuente-art383';

interface EmployeeCalculationInput {
  id: number;
  base_salary: Prisma.Decimal;
  arl_risk_level: number | null;
}

/**
 * Earnings JSON persisted on payroll_items. The optional keys use the EXACT
 * shapes read by DianPayrollProvider.mapEarnings, so the DSPNE XML is
 * populated without touching the XML builders. Historical runs (no
 * novelties) simply lack the optional keys.
 */
interface EarningsBreakdown {
  base_salary: number;
  transport_subsidy: number;
  overtime?: Array<{
    type: string;
    hours: number;
    percentage: number;
    amount: number;
  }>;
  vacations?: Array<{
    start_date: string;
    end_date: string;
    quantity: number;
    payment: number;
  }>;
  disabilities?: Array<{
    start_date: string;
    end_date: string;
    quantity: number;
    type: number;
    payment: number;
  }>;
  licenses?: Array<{
    start_date: string;
    end_date: string;
    quantity: number;
    type: string;
    payment: number;
  }>;
  bonuses?: Array<{ taxable: number; non_taxable: number }>;
  commissions?: number;
  total: number;
}

interface DeductionsBreakdown {
  health: number;
  pension: number;
  retention: number;
  advance_deduction: number;
  /** Manual deduction novelties — same shape read by mapDeductions (DSPNE). */
  other_deductions?: Array<{ description: string; amount: number }>;
  total: number;
  /**
   * Detail of the art. 383 ET progressive labor withholding (procedure 1).
   * Optional: historical runs calculated with the legacy flat 1% (or runs
   * where no UVT was configured) do not carry it.
   */
  retention_details?: LaborWithholdingResult;
}

/** DSPNE codes for overtime/surcharge entries (HorasExtras element). */
const DSPNE_OVERTIME_TYPE: Record<string, string> = {
  overtime_diurna: 'HED',
  overtime_nocturna: 'HEN',
  overtime_dominical_diurna: 'HEDDF',
  overtime_dominical_nocturna: 'HENDF',
  surcharge_nocturno: 'RN',
  surcharge_dominical: 'RDDF',
};

/** DIAN incapacity type codes: 1 = común, 2 = profesional, 3 = laboral. */
const DSPNE_INCAPACITY_TYPE: Record<string, number> = {
  incapacity_general: 1,
  incapacity_laboral: 3,
};

interface EmployerCostsBreakdown {
  health: number;
  pension: number;
  arl: number;
  sena: number;
  icbf: number;
  compensation_fund: number;
  total: number;
}

interface ProvisionsBreakdown {
  severance: number; // proportional_salary * severance_rate (1/12)
  severance_interest: number; // severance * (severance_interest_rate / 12)
  vacation: number; // proportional_salary * vacation_rate (15/360)
  bonus: number; // proportional_salary * bonus_rate (1/12)
  total: number;
}

export interface PayrollItemCalculation {
  employee_id: number;
  base_salary: number;
  worked_days: number;
  earnings: EarningsBreakdown;
  deductions: DeductionsBreakdown;
  employer_costs: EmployerCostsBreakdown;
  provisions: ProvisionsBreakdown;
  total_earnings: number;
  total_deductions: number;
  total_employer_costs: number;
  net_pay: number;
}

@Injectable()
export class PayrollCalculationService {
  private readonly logger = new Logger(PayrollCalculationService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly advances_service: AdvancesService,
    private readonly payroll_rules_service: PayrollRulesService,
    private readonly novelties_service: NoveltiesService,
  ) {}

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
      ...(store_id && {
        employee_stores: {
          some: { store_id, status: 'active' },
        },
      }),
    };

    const employees = await this.prisma.employees.findMany({ where });

    if (employees.length === 0) {
      throw new VendixHttpException(ErrorCodes.PAYROLL_CALC_001);
    }

    const worked_days = this.calculateWorkedDays(period_start, period_end);
    const calculations: PayrollItemCalculation[] = [];
    const payroll_run = await this.prisma.payroll_runs.findFirst({
      where: { id: payroll_run_id },
      select: { id: true, accounting_entity_id: true },
    });

    if (!payroll_run) {
      throw new VendixHttpException(ErrorCodes.PAYROLL_FIND_002);
    }

    // Resolve the UVT once per run (art. 383 ET progressive withholding).
    // Precedence: entity-specific uvt_values row → org-level default.
    const fiscal_year = period_start.getFullYear();
    const uvt_value = await this.payroll_rules_service.getUvtValueForYear(
      fiscal_year,
      payroll_run.accounting_entity_id ?? null,
    );

    // Pre-fetch advance deductions for all employees
    const advance_deductions_map = new Map<number, number>();
    for (const employee of employees) {
      const deduction =
        await this.advances_service.calculateDeductionForPayroll(employee.id);
      if (deduction > 0) {
        advance_deductions_map.set(employee.id, deduction);
      }
    }

    // Load payroll novelties for the period:
    // - pending novelties overlapping the period (first calculation), plus
    // - novelties already applied to THIS run (recalculation — idempotent:
    //   they are re-valuated and re-attached, never double-counted).
    const employee_ids = employees.map((employee) => employee.id);
    const pending_novelties = await this.novelties_service.findPendingForPeriod(
      employee_ids,
      period_start,
      period_end,
    );
    const applied_novelties = await this.prisma.payroll_novelties.findMany({
      where: { payroll_run_id, status: 'applied' },
      orderBy: { date_start: 'asc' },
    });
    const run_novelties = [
      ...pending_novelties,
      ...applied_novelties.filter(
        (applied) =>
          // Skip duplicates and novelties of employees no longer in the run
          // (those are released back to pending by the transaction below).
          employee_ids.includes(applied.employee_id) &&
          !pending_novelties.some((pending) => pending.id === applied.id),
      ),
    ];

    const novelties_by_employee = new Map<number, ValuatedNovelty[]>();
    for (const employee of employees) {
      const employee_novelties = run_novelties.filter(
        (novelty) => novelty.employee_id === employee.id,
      );
      if (employee_novelties.length === 0) continue;
      novelties_by_employee.set(
        employee.id,
        employee_novelties.map((novelty) =>
          valuateNovelty(novelty, Number(employee.base_salary), rules),
        ),
      );
    }

    for (const employee of employees) {
      const advance_deduction = advance_deductions_map.get(employee.id) || 0;
      const calc = this.calculateEmployeePayroll(
        {
          id: employee.id,
          base_salary: employee.base_salary,
          arl_risk_level: employee.arl_risk_level,
        },
        worked_days,
        rules,
        advance_deduction,
        uvt_value,
        fiscal_year,
        novelties_by_employee.get(employee.id) || [],
      );
      calculations.push(calc);
    }

    // Persist payroll items in a transaction
    await this.prisma.$transaction(async (tx: any) => {
      // Delete existing items for this run (recalculation scenario)
      await tx.payroll_items.deleteMany({
        where: { payroll_run_id },
      });

      // Re-bind novelties to this run (idempotent on recalculation):
      // release whatever was attached before, then attach the set used now.
      await this.novelties_service.releaseFromRun(payroll_run_id, tx);
      await this.novelties_service.attachToRun(
        tx,
        run_novelties.map((novelty) => novelty.id),
        payroll_run_id,
      );

      // Create new items
      for (const calc of calculations) {
        await tx.payroll_items.create({
          data: {
            payroll_run_id,
            employee_id: calc.employee_id,
            accounting_entity_id: payroll_run.accounting_entity_id,
            base_salary: new Prisma.Decimal(calc.base_salary),
            worked_days: calc.worked_days,
            earnings: calc.earnings as any,
            deductions: calc.deductions as any,
            employer_costs: calc.employer_costs as any,
            provisions: calc.provisions as any,
            total_earnings: new Prisma.Decimal(calc.total_earnings),
            total_deductions: new Prisma.Decimal(calc.total_deductions),
            total_employer_costs: new Prisma.Decimal(calc.total_employer_costs),
            net_pay: new Prisma.Decimal(calc.net_pay),
          },
        });
      }

      // Update payroll run totals
      const total_earnings = calculations.reduce(
        (sum, c) => sum + c.total_earnings,
        0,
      );
      const total_deductions = calculations.reduce(
        (sum, c) => sum + c.total_deductions,
        0,
      );
      const total_employer_costs = calculations.reduce(
        (sum, c) => sum + c.total_employer_costs,
        0,
      );
      const total_net_pay = calculations.reduce((sum, c) => sum + c.net_pay, 0);

      await tx.payroll_runs.update({
        where: { id: payroll_run_id },
        data: {
          status: 'calculated',
          total_earnings: new Prisma.Decimal(this.round(total_earnings)),
          total_deductions: new Prisma.Decimal(this.round(total_deductions)),
          total_employer_costs: new Prisma.Decimal(
            this.round(total_employer_costs),
          ),
          total_net_pay: new Prisma.Decimal(this.round(total_net_pay)),
        },
      });
    });

    // Apply advance deductions to employee advances (outside main tx to use AdvancesService)
    for (const calc of calculations) {
      const advance_deduction = calc.deductions.advance_deduction;
      if (advance_deduction > 0) {
        // Find the payroll item that was just created
        const payroll_item = await this.prisma.payroll_items.findFirst({
          where: { payroll_run_id, employee_id: calc.employee_id },
          select: { id: true },
        });
        if (payroll_item) {
          await this.advances_service.applyPayrollDeduction(
            calc.employee_id,
            payroll_item.id,
            advance_deduction,
          );
        }
      }
    }

    this.logger.log(
      `Calculated payroll run #${payroll_run_id}: ${calculations.length} employees, ` +
        `net_pay total: ${calculations.reduce((s, c) => s + c.net_pay, 0)}`,
    );

    return calculations;
  }

  /**
   * Pure calculation for a single employee.
   *
   * Novelties (already valuated) are folded in as follows:
   * - `days_adjustment` (unpaid leave) reduces worked_days BEFORE proration.
   * - Salary earnings (overtime, surcharges, commissions, salary bonuses)
   *   add to the IBC (base for health/pension/employer costs/provisions)
   *   and to the art. 383 withholding taxable base.
   * - Non-salary replacements (vacations, incapacities, paid leaves) add to
   *   total earnings but NOT to the IBC base.
   * - `deduction` novelties add to total deductions (other_deductions).
   * - The transport subsidy stays out of the IBC (unchanged behavior).
   */
  calculateEmployeePayroll(
    employee: EmployeeCalculationInput,
    worked_days: number,
    rules: PayrollRules,
    advance_deduction: number = 0,
    uvt_value: number | null = null,
    year: number = new Date().getFullYear(),
    novelties: ValuatedNovelty[] = [],
  ): PayrollItemCalculation {
    const salary = Number(employee.base_salary);

    // Unpaid leave reduces worked days BEFORE proration
    const unpaid_days = novelties
      .filter((novelty) => novelty.kind === 'days_adjustment')
      .reduce((sum, novelty) => sum + (novelty.days || 0), 0);
    const effective_worked_days = Math.max(
      Math.round(worked_days - unpaid_days),
      0,
    );
    const proportion = effective_worked_days / rules.days_per_month;

    // Earnings
    const proportional_salary = this.round(salary * proportion);
    const qualifies_for_transport =
      salary <= rules.minimum_wage * rules.transport_subsidy_threshold;
    const transport_subsidy = qualifies_for_transport
      ? this.round(rules.transport_subsidy * proportion)
      : 0;

    // ── Novelty buckets (DSPNE-exact shapes) ──
    const overtime_entries: NonNullable<EarningsBreakdown['overtime']> = [];
    const vacation_entries: NonNullable<EarningsBreakdown['vacations']> = [];
    const disability_entries: NonNullable<EarningsBreakdown['disabilities']> =
      [];
    const license_entries: NonNullable<EarningsBreakdown['licenses']> = [];
    const bonus_entries: NonNullable<EarningsBreakdown['bonuses']> = [];
    let commissions_total = 0;
    const other_deduction_entries: NonNullable<
      DeductionsBreakdown['other_deductions']
    > = [];

    // Salary earnings: overtime, surcharges, commissions, salary bonuses.
    // They feed the IBC and the labor withholding taxable base.
    let salary_novelty_earnings = 0;
    // Non-salary replacements: vacations, incapacities, paid leaves.
    let non_ibc_novelty_earnings = 0;

    for (const novelty of novelties) {
      const start = novelty.date_start || '';
      const end = novelty.date_end || start;

      if (DSPNE_OVERTIME_TYPE[novelty.novelty_type]) {
        overtime_entries.push({
          type: DSPNE_OVERTIME_TYPE[novelty.novelty_type],
          hours: novelty.hours || 0,
          percentage: this.round((novelty.percentage || 0) * 100),
          amount: novelty.amount,
        });
        salary_novelty_earnings += novelty.amount;
        continue;
      }

      switch (novelty.novelty_type) {
        case 'vacation':
          vacation_entries.push({
            start_date: start,
            end_date: end,
            quantity: novelty.days || 0,
            payment: novelty.amount,
          });
          non_ibc_novelty_earnings += novelty.amount;
          break;
        case 'incapacity_general':
        case 'incapacity_laboral':
          disability_entries.push({
            start_date: start,
            end_date: end,
            quantity: novelty.days || 0,
            type: DSPNE_INCAPACITY_TYPE[novelty.novelty_type],
            payment: novelty.amount,
          });
          non_ibc_novelty_earnings += novelty.amount;
          break;
        case 'leave_paid':
          license_entries.push({
            start_date: start,
            end_date: end,
            quantity: novelty.days || 0,
            type: 'remunerada',
            payment: novelty.amount,
          });
          non_ibc_novelty_earnings += novelty.amount;
          break;
        case 'leave_unpaid':
          // Already handled via effective_worked_days; reported for DSPNE.
          license_entries.push({
            start_date: start,
            end_date: end,
            quantity: novelty.days || 0,
            type: 'no_remunerada',
            payment: 0,
          });
          break;
        case 'bonus':
          bonus_entries.push({ taxable: novelty.amount, non_taxable: 0 });
          salary_novelty_earnings += novelty.amount;
          break;
        case 'commission':
          commissions_total = this.round(commissions_total + novelty.amount);
          salary_novelty_earnings += novelty.amount;
          break;
        case 'other_deduction':
          other_deduction_entries.push({
            description: `Novedad #${novelty.novelty_id}`,
            amount: novelty.amount,
          });
          break;
        default:
          break;
      }
    }

    salary_novelty_earnings = this.round(salary_novelty_earnings);
    non_ibc_novelty_earnings = this.round(non_ibc_novelty_earnings);
    const other_deductions_total = this.round(
      other_deduction_entries.reduce((sum, entry) => sum + entry.amount, 0),
    );

    // IBC: proportional salary + salary novelty earnings (transport subsidy
    // and non-salary replacements stay out).
    const ibc_base = this.round(proportional_salary + salary_novelty_earnings);

    const total_earnings = this.round(
      proportional_salary +
        transport_subsidy +
        salary_novelty_earnings +
        non_ibc_novelty_earnings,
    );

    // Deductions (employee portion) - calculated on the IBC, not on the
    // transport subsidy
    const health_deduction = this.round(ibc_base * rules.health_employee_rate);
    const pension_deduction = this.round(
      ibc_base * rules.pension_employee_rate,
    );

    // Labor withholding (retefuente):
    // - With a UVT configured: art. 383 ET progressive table, procedure 1.
    //   Base = salary earnings of the period (proportional salary plus
    //   salary novelties: overtime, surcharges, commissions, salary bonuses;
    //   the transport subsidy is NOT salary income for withholding purposes).
    // - Without UVT: legacy flat 1% fallback for high earners (never a
    //   silent 0 — the missing UVT is logged so it can be configured).
    let retention: number;
    let retention_details: LaborWithholdingResult | undefined;
    if (uvt_value !== null && uvt_value > 0) {
      retention_details = calculateLaborWithholding({
        taxable_earnings: ibc_base,
        health_deduction,
        pension_deduction,
        uvt_value,
        year,
      });
      retention = retention_details.retention;
    } else {
      this.logger.warn(
        `No UVT value configured for year ${year}: falling back to legacy flat 1% ` +
          `labor withholding for employee #${employee.id}. Configure uvt_values to ` +
          'apply the art. 383 ET progressive table.',
      );
      // Legacy simplified retention: 0 if salary < threshold × min wage
      retention =
        salary >= rules.minimum_wage * rules.retention_exempt_threshold
          ? this.round(proportional_salary * 0.01) // Simplified 1% for high earners
          : 0;
    }
    const total_deductions = this.round(
      health_deduction +
        pension_deduction +
        retention +
        advance_deduction +
        other_deductions_total,
    );

    // Employer costs (calculated on the IBC)
    const arl_rate =
      rules.arl_rates[employee.arl_risk_level || 1] || rules.arl_rates[1];
    const health_employer = this.round(ibc_base * rules.health_employer_rate);
    const pension_employer = this.round(
      ibc_base * rules.pension_employer_rate,
    );
    const arl_cost = this.round(ibc_base * arl_rate);
    const sena_cost = this.round(ibc_base * rules.sena_rate);
    const icbf_cost = this.round(ibc_base * rules.icbf_rate);
    const compensation_fund_cost = this.round(
      ibc_base * rules.compensation_fund_rate,
    );
    const total_employer_costs = this.round(
      health_employer +
        pension_employer +
        arl_cost +
        sena_cost +
        icbf_cost +
        compensation_fund_cost,
    );

    // Provisions (monthly accrual, on the IBC)
    const severance = this.round(ibc_base * rules.severance_rate);
    const severance_interest = this.round(
      severance * (rules.severance_interest_rate / 12),
    );
    const vacation = this.round(ibc_base * rules.vacation_rate);
    const bonus = this.round(ibc_base * rules.bonus_rate);
    const total_provisions = this.round(
      severance + severance_interest + vacation + bonus,
    );

    const net_pay = this.round(total_earnings - total_deductions);

    return {
      employee_id: employee.id,
      base_salary: salary,
      worked_days: effective_worked_days,
      earnings: {
        base_salary: proportional_salary,
        transport_subsidy,
        ...(overtime_entries.length ? { overtime: overtime_entries } : {}),
        ...(vacation_entries.length ? { vacations: vacation_entries } : {}),
        ...(disability_entries.length
          ? { disabilities: disability_entries }
          : {}),
        ...(license_entries.length ? { licenses: license_entries } : {}),
        ...(bonus_entries.length ? { bonuses: bonus_entries } : {}),
        ...(commissions_total > 0 ? { commissions: commissions_total } : {}),
        total: total_earnings,
      },
      deductions: {
        health: health_deduction,
        pension: pension_deduction,
        retention,
        advance_deduction,
        ...(other_deduction_entries.length
          ? { other_deductions: other_deduction_entries }
          : {}),
        total: total_deductions,
        ...(retention_details ? { retention_details } : {}),
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
      provisions: {
        severance,
        severance_interest,
        vacation,
        bonus,
        total: total_provisions,
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
