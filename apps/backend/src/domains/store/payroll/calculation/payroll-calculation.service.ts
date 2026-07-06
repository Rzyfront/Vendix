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
  EXONERATION_MAX_SMMLV,
  FSP_SOLIDARITY_RATE,
  IBC_MAX_SMMLV,
  IBC_MIN_SMMLV,
  INTEGRAL_IBC_FACTOR,
  getFspRate,
} from './colombian-rules';
import {
  Art387Deductions,
  RetentionProcedure,
  calculateLaborWithholding,
  LaborWithholdingResult,
} from './retefuente-art383';

interface EmployeeCalculationInput {
  id: number;
  base_salary: Prisma.Decimal;
  arl_risk_level: number | null;
  /**
   * Salary modality. `integral` employees cotize social security on 70% of the
   * salary (factor prestacional excluded). Absent → treated as `ordinary`.
   */
  salary_type?: 'ordinary' | 'integral';
  /**
   * Snapshot del perfil fiscal (art. 387 ET) del empleado, resuelto fuera
   * del cálculo para que la función pura no consulte Prisma. Si llega
   * `undefined`, el cálculo cae al comportamiento histórico (sin art. 387).
   */
  fiscal_profile?: {
    dependents_count: number;
    housing_interest_monthly: number;
    prepaid_medicine_monthly: number;
    voluntary_pension_monthly: number;
    afc_monthly: number;
    retention_procedure: RetentionProcedure;
    fixed_retention_rate: number | null;
  };
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
    /** Portion of `payment` borne by the employer (incapacity days 1-2). */
    employer_amount?: number;
    /** Portion of `payment` reimbursed by a third party (EPS day 3+ / ARL). */
    reimbursable_amount?: number;
    /** Entity that reimburses `reimbursable_amount`. */
    reimbursed_by?: 'eps' | 'arl';
  }>;
  licenses?: Array<{
    start_date: string;
    end_date: string;
    quantity: number;
    type: string;
    payment: number;
    /** Portion of `payment` borne by the employer (e.g. bereavement leave). */
    employer_amount?: number;
    /** Portion of `payment` reimbursed by the EPS (maternity/paternity leave). */
    reimbursable_amount?: number;
    /** Entity that reimburses `reimbursable_amount`. */
    reimbursed_by?: 'eps' | 'arl';
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
  /**
   * Fondo de Solidaridad Pensional (employee side). Combined amount (solidarity
   * + subsistence subaccounts). 0 when the IBC is below 4 SMMLV. The DSPNE XML
   * split is emitted via `solidarity_fund_amount` / `subsistence_fund_amount`.
   */
  fsp: number;
  /** FSP solidarity subaccount (1% base) — DSPNE `FondoSP`. Present when > 0. */
  solidarity_fund_amount?: number;
  /** FSP solidarity subaccount rate as a percentage (e.g. 1). */
  solidarity_fund_pct?: number;
  /** FSP additional "subsistencia" subaccount — DSPNE `FondoSubsistencia`. Present when > 0. */
  subsistence_fund_amount?: number;
  /** FSP subsistence subaccount rate as a percentage (e.g. 0.2). */
  subsistence_fund_pct?: number;
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

    // Resolve art. 387 ET fiscal profiles for all employees in one query
    // (so a N+1 doesn't sneak into the calculation loop). Missing profiles
    // are silently treated as "no deductions" — historical behavior.
    const fiscal_profiles_map = new Map<
      number,
      {
        dependents_count: number;
        housing_interest_monthly: number;
        prepaid_medicine_monthly: number;
        voluntary_pension_monthly: number;
        afc_monthly: number;
        retention_procedure: RetentionProcedure;
        fixed_retention_rate: number | null;
      }
    >();
    if (employee_ids.length > 0) {
      const unscoped = this.prisma.withoutScope() as any;
      const profiles = await unscoped.employee_fiscal_profiles.findMany({
        where: { employee_id: { in: employee_ids } },
      });
      for (const row of profiles) {
        fiscal_profiles_map.set(row.employee_id, {
          dependents_count: row.dependents_count,
          housing_interest_monthly: Number(row.housing_interest_monthly),
          prepaid_medicine_monthly: Number(row.prepaid_medicine_monthly),
          voluntary_pension_monthly: Number(row.voluntary_pension_monthly),
          afc_monthly: Number(row.afc_monthly),
          retention_procedure: row.retention_procedure as RetentionProcedure,
          fixed_retention_rate:
            row.fixed_retention_rate != null
              ? Number(row.fixed_retention_rate)
              : null,
        });
      }
    }

    for (const employee of employees) {
      const advance_deduction = advance_deductions_map.get(employee.id) || 0;
      const calc = this.calculateEmployeePayroll(
        {
          id: employee.id,
          base_salary: employee.base_salary,
          arl_risk_level: employee.arl_risk_level,
          salary_type: employee.salary_type,
          fiscal_profile: fiscal_profiles_map.get(employee.id),
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
            ...(novelty.employer_amount !== undefined
              ? { employer_amount: novelty.employer_amount }
              : {}),
            ...(novelty.reimbursable_amount !== undefined
              ? { reimbursable_amount: novelty.reimbursable_amount }
              : {}),
            ...(novelty.reimbursed_by
              ? { reimbursed_by: novelty.reimbursed_by }
              : {}),
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
        case 'maternity_leave':
        case 'paternity_leave':
          // EPS-borne leave (100%): reported as a license and reimbursable.
          license_entries.push({
            start_date: start,
            end_date: end,
            quantity: novelty.days || 0,
            type:
              novelty.novelty_type === 'maternity_leave'
                ? 'maternidad'
                : 'paternidad',
            payment: novelty.amount,
            employer_amount: novelty.employer_amount ?? 0,
            reimbursable_amount: novelty.reimbursable_amount ?? novelty.amount,
            reimbursed_by: novelty.reimbursed_by ?? 'eps',
          });
          non_ibc_novelty_earnings += novelty.amount;
          break;
        case 'bereavement_leave':
          // Employer-borne remunerated leave (luto, 5 business days by law).
          license_entries.push({
            start_date: start,
            end_date: end,
            quantity: novelty.days || 0,
            type: 'luto',
            payment: novelty.amount,
            employer_amount: novelty.employer_amount ?? novelty.amount,
            reimbursable_amount: novelty.reimbursable_amount ?? 0,
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
    // and non-salary replacements stay out). This is the salary-income base
    // used for the labor withholding (retefuente).
    const ibc_base = this.round(proportional_salary + salary_novelty_earnings);

    const total_earnings = this.round(
      proportional_salary +
        transport_subsidy +
        salary_novelty_earnings +
        non_ibc_novelty_earnings,
    );

    // ── Social-security contribution base (IBC for salud/pensión/FSP/aportes) ──
    // - Salario integral cotiza on 70% of the salary (factor prestacional out).
    // - Clamped to the legal floor (1 SMMLV) and ceiling (25 SMMLV), prorated by
    //   the worked-days proportion so partial periods keep their proration.
    const is_integral = employee.salary_type === 'integral';
    const integral_factor = is_integral ? INTEGRAL_IBC_FACTOR : 1;
    const contribution_base_raw = this.round(ibc_base * integral_factor);
    const ibc_floor = this.round(
      rules.minimum_wage * IBC_MIN_SMMLV * proportion,
    );
    const ibc_ceiling = this.round(
      rules.minimum_wage * IBC_MAX_SMMLV * proportion,
    );
    const contribution_base = Math.min(
      Math.max(contribution_base_raw, ibc_floor),
      ibc_ceiling,
    );

    // Monthly-equivalent IBC in SMMLV drives the staggered FSP rate and the
    // Ley 1607 exoneration threshold (both are monthly brackets, so a partial
    // period is scaled back up to a full month before it is classified).
    const monthly_equivalent_ibc =
      proportion > 0
        ? contribution_base_raw / proportion
        : contribution_base_raw;
    const ibc_in_smmlv =
      rules.minimum_wage > 0 ? monthly_equivalent_ibc / rules.minimum_wage : 0;

    // Deductions (employee portion) - calculated on the contribution base, not
    // on the transport subsidy.
    const health_deduction = this.round(
      contribution_base * rules.health_employee_rate,
    );
    const pension_deduction = this.round(
      contribution_base * rules.pension_employee_rate,
    );

    // FSP (Fondo de Solidaridad Pensional): staggered employee deduction on the
    // pension IBC. 0 below 4 SMMLV. Split into the solidarity (1%) and the
    // additional "subsistencia" subaccounts for the DSPNE XML.
    const fsp_rate = getFspRate(ibc_in_smmlv);
    const fsp = this.round(contribution_base * fsp_rate);
    const fsp_solidarity_amount =
      fsp_rate > 0 ? this.round(contribution_base * FSP_SOLIDARITY_RATE) : 0;
    const fsp_subsistence_amount = this.round(fsp - fsp_solidarity_amount);

    // Labor withholding (retefuente):
    // - With a UVT configured: art. 383 ET progressive table (procedure 1)
    //   or art. 386 ET fixed-rate (procedure 2), gated by
    //   employee_fiscal_profiles.retention_procedure. art. 387 ET
    //   deductions (dependientes, intereses vivienda, medicina prepagada,
    //   pensión voluntaria, AFC) are applied before the 25% exempt income
    //   and the global 40% / 1.340 UVT cap of art. 336 ET.
    //   Base = salary earnings of the period (proportional salary plus
    //   salary novelties: overtime, surcharges, commissions, salary bonuses;
    //   the transport subsidy is NOT salary income for withholding purposes).
    // - Without UVT: legacy flat 1% fallback for high earners (never a
    //   silent 0 — the missing UVT is logged so it can be configured).
    let retention: number;
    let retention_details: LaborWithholdingResult | undefined;
    if (uvt_value !== null && uvt_value > 0) {
      const fiscal_profile = employee.fiscal_profile;
      const has_art_387_deductions =
        !!fiscal_profile &&
        (fiscal_profile.dependents_count > 0 ||
          fiscal_profile.housing_interest_monthly > 0 ||
          fiscal_profile.prepaid_medicine_monthly > 0 ||
          fiscal_profile.voluntary_pension_monthly > 0 ||
          fiscal_profile.afc_monthly > 0);
      const art_387_deductions: Art387Deductions | undefined = has_art_387_deductions
        ? {
            dependents_count: fiscal_profile!.dependents_count,
            housing_interest_monthly: fiscal_profile!.housing_interest_monthly,
            prepaid_medicine_monthly: fiscal_profile!.prepaid_medicine_monthly,
            voluntary_pension_monthly:
              fiscal_profile!.voluntary_pension_monthly,
            afc_monthly: fiscal_profile!.afc_monthly,
          }
        : undefined;
      retention_details = calculateLaborWithholding({
        taxable_earnings: ibc_base,
        health_deduction,
        pension_deduction,
        uvt_value,
        year,
        ...(art_387_deductions ? { art_387_deductions } : {}),
        ...(fiscal_profile?.retention_procedure
          ? { procedure: fiscal_profile.retention_procedure }
          : {}),
        ...(fiscal_profile?.fixed_retention_rate != null
          ? { fixed_retention_rate: fiscal_profile.fixed_retention_rate / 100 }
          : {}),
      });
      if (retention_details.proc2_fallback) {
        this.logger.warn(
          `Employee #${employee.id} requested proc2 but no fixed_retention_rate ` +
            `is set for the current semester. Falling back to proc1.`,
        );
      }
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
        fsp +
        retention +
        advance_deduction +
        other_deductions_total,
    );

    // Employer costs (calculated on the contribution base).
    //
    // Ley 1607/2012 exoneration (art. 114-1 ET): an exonerated society does NOT
    // pay employer health (8.5%), SENA (2%) nor ICBF (3%) for employees whose
    // monthly IBC is below 10 SMMLV. Pension (12%), ARL and the compensation
    // fund (caja, 4%) are always due.
    //
    // TODO(exoneration-flag): gate this on an explicit organization/employer
    // `is_exonerated` flag once the schema exposes one. It does NOT exist today,
    // so — per the Colombian default for SAS/limitadas — we assume the society
    // is exonerated and gate purely by the 10-SMMLV threshold. Reported as a
    // knowledge gap.
    const is_exonerated_for_employee = ibc_in_smmlv < EXONERATION_MAX_SMMLV;

    const arl_rate =
      rules.arl_rates[employee.arl_risk_level || 1] || rules.arl_rates[1];
    const health_employer = is_exonerated_for_employee
      ? 0
      : this.round(contribution_base * rules.health_employer_rate);
    const pension_employer = this.round(
      contribution_base * rules.pension_employer_rate,
    );
    const arl_cost = this.round(contribution_base * arl_rate);
    const sena_cost = is_exonerated_for_employee
      ? 0
      : this.round(contribution_base * rules.sena_rate);
    const icbf_cost = is_exonerated_for_employee
      ? 0
      : this.round(contribution_base * rules.icbf_rate);
    const compensation_fund_cost = this.round(
      contribution_base * rules.compensation_fund_rate,
    );
    const total_employer_costs = this.round(
      health_employer +
        pension_employer +
        arl_cost +
        sena_cost +
        icbf_cost +
        compensation_fund_cost,
    );

    // Provisions (monthly accrual). Salario integral provisions on 70% of the
    // salary (factor prestacional excluded); the 25-SMMLV cap does NOT apply to
    // provisions, so this uses the integral-adjusted base rather than the
    // clamped contribution base.
    const provision_base = this.round(ibc_base * integral_factor);
    const severance = this.round(provision_base * rules.severance_rate);
    const severance_interest = this.round(
      severance * (rules.severance_interest_rate / 12),
    );
    const vacation = this.round(provision_base * rules.vacation_rate);
    const bonus = this.round(provision_base * rules.bonus_rate);
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
        fsp,
        ...(fsp_solidarity_amount > 0
          ? {
              solidarity_fund_amount: fsp_solidarity_amount,
              solidarity_fund_pct: this.round(FSP_SOLIDARITY_RATE * 100),
            }
          : {}),
        ...(fsp_subsistence_amount > 0
          ? {
              subsistence_fund_amount: fsp_subsistence_amount,
              subsistence_fund_pct: this.round((fsp_rate - FSP_SOLIDARITY_RATE) * 100),
            }
          : {}),
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
