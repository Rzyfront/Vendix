import { Prisma } from '@prisma/client';
import { PayrollCalculationService } from './payroll-calculation.service';
import { COLOMBIAN_PAYROLL_DEFAULTS_2026 } from './colombian-rules';
import { calculateLaborWithholding } from './retefuente-art383';
import { valuateNovelty } from './novelty-valuation';

describe('PayrollCalculationService — labor withholding (art. 383 ET)', () => {
  const UVT_2026 = 52374;
  const rules = COLOMBIAN_PAYROLL_DEFAULTS_2026;

  const createService = () =>
    new PayrollCalculationService(
      {} as any, // prisma — not used by calculateEmployeePayroll
      {} as any, // advances — not used by calculateEmployeePayroll
      {} as any, // rules service — only used by calculateForRun
      {} as any, // novelties service — only used by calculateForRun
    );

  const employee = (base_salary: number) => ({
    id: 700,
    base_salary: new Prisma.Decimal(base_salary),
    arl_risk_level: 1,
  });

  it('applies the art. 383 progressive table when a UVT value is provided', () => {
    const service = createService();

    const calc = service.calculateEmployeePayroll(
      employee(10_000_000),
      30,
      rules,
      0,
      UVT_2026,
      2026,
    );

    // Hand-verified: base 10.000.000, health/pension 400.000 each,
    // exempt 2.300.000, base depurada 6.900.000 (131,74 UVT, bracket 19%)
    // → 365.649,3 → 365.600 (nearest 100).
    expect(calc.deductions.retention).toBe(365_600);
    expect(calc.deductions.retention_details).toBeDefined();
    expect(calc.deductions.retention_details).toEqual(
      calculateLaborWithholding({
        taxable_earnings: 10_000_000,
        health_deduction: 400_000,
        pension_deduction: 400_000,
        uvt_value: UVT_2026,
        year: 2026,
      }),
    );
    expect(calc.deductions.retention_details?.method).toBe('art383_proc1');
    expect(calc.deductions.total).toBe(400_000 + 400_000 + 365_600);
  });

  it('excludes the transport subsidy from the withholding base', () => {
    const service = createService();

    // Low salary: qualifies for transport subsidy. The withholding input must
    // be the proportional salary only (transport subsidy is not salary income
    // for retefuente purposes).
    const calc = service.calculateEmployeePayroll(
      employee(1_423_500),
      30,
      rules,
      0,
      UVT_2026,
      2026,
    );

    expect(calc.earnings.transport_subsidy).toBe(rules.transport_subsidy);
    expect(calc.deductions.retention).toBe(0);
    expect(calc.deductions.retention_details).toEqual(
      calculateLaborWithholding({
        taxable_earnings: 1_423_500,
        health_deduction: calc.deductions.health,
        pension_deduction: calc.deductions.pension,
        uvt_value: UVT_2026,
        year: 2026,
      }),
    );
  });

  it('prorates the withholding base for partial periods', () => {
    const service = createService();

    const calc = service.calculateEmployeePayroll(
      employee(10_000_000),
      15,
      rules,
      0,
      UVT_2026,
      2026,
    );

    // 15/30 days → proportional salary 5.000.000 is the taxable base
    expect(calc.deductions.retention_details?.base_depurada).toBe(
      calculateLaborWithholding({
        taxable_earnings: 5_000_000,
        health_deduction: 200_000,
        pension_deduction: 200_000,
        uvt_value: UVT_2026,
        year: 2026,
      }).base_depurada,
    );
  });

  it('falls back to the legacy flat 1% with a warning when no UVT is configured', () => {
    const service = createService();
    const warn_spy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);

    const calc = service.calculateEmployeePayroll(
      employee(10_000_000),
      30,
      rules,
      0,
      null,
      2026,
    );

    // Legacy behavior: salary ≥ 4 × minimum wage ⇒ flat 1% of proportional salary
    expect(calc.deductions.retention).toBe(100_000);
    expect(calc.deductions.retention_details).toBeUndefined();
    expect(warn_spy).toHaveBeenCalledTimes(1);
    expect(warn_spy.mock.calls[0][0]).toContain('falling back to legacy flat 1%');
  });

  it('legacy fallback keeps retention at 0 below the exempt threshold', () => {
    const service = createService();
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);

    const calc = service.calculateEmployeePayroll(
      employee(2_000_000), // < 4 × 1.423.500
      30,
      rules,
      0,
      null,
      2026,
    );

    expect(calc.deductions.retention).toBe(0);
    expect(calc.deductions.retention_details).toBeUndefined();
  });
});

describe('PayrollCalculationService — payroll novelties integration', () => {
  const UVT_2026 = 52374;
  const rules = COLOMBIAN_PAYROLL_DEFAULTS_2026;
  const BASE_SALARY = 2_300_000;

  const createService = () =>
    new PayrollCalculationService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

  const employee = () => ({
    id: 700,
    base_salary: new Prisma.Decimal(BASE_SALARY),
    arl_risk_level: 1,
  });

  const valuate = (row: any) =>
    valuateNovelty(
      { id: 1, date_start: new Date('2026-06-05'), ...row },
      BASE_SALARY,
      rules,
    );

  it('extends earnings with the exact DSPNE keys and includes salary novelties in the IBC', () => {
    const service = createService();

    const novelties = [
      valuate({ id: 1, novelty_type: 'overtime_nocturna', hours: 10 }), // 175.000
      valuate({ id: 2, novelty_type: 'commission', amount: 120_000 }),
      valuate({ id: 3, novelty_type: 'bonus', amount: 300_000 }),
      valuate({
        id: 4,
        novelty_type: 'vacation',
        days: 5,
        date_end: new Date('2026-06-10'),
      }), // 383.333,33
      valuate({ id: 5, novelty_type: 'incapacity_general', days: 3 }), // 153.341
      valuate({ id: 6, novelty_type: 'other_deduction', amount: 50_000 }),
    ];

    const calc = service.calculateEmployeePayroll(
      employee(),
      30,
      rules,
      0,
      UVT_2026,
      2026,
      novelties,
    );

    // DSPNE-exact earnings keys (read as-is by DianPayrollProvider.mapEarnings)
    expect(calc.earnings.overtime).toEqual([
      { type: 'HEN', hours: 10, percentage: 75, amount: 175_000 },
    ]);
    expect(calc.earnings.commissions).toBe(120_000);
    expect(calc.earnings.bonuses).toEqual([
      { taxable: 300_000, non_taxable: 0 },
    ]);
    expect(calc.earnings.vacations).toEqual([
      {
        start_date: '2026-06-05',
        end_date: '2026-06-10',
        quantity: 5,
        payment: 383_333.33,
      },
    ]);
    expect(calc.earnings.disabilities).toEqual([
      {
        start_date: '2026-06-05',
        end_date: '2026-06-05',
        quantity: 3,
        type: 1,
        payment: 153_341,
      },
    ]);

    // IBC = proportional salary + salary novelties (extras/commission/bonus),
    // excluding transport subsidy, vacations and incapacities.
    const ibc = 2_300_000 + 175_000 + 120_000 + 300_000; // 2.895.000
    expect(calc.deductions.health).toBe(115_800); // 2.895.000 × 4%
    expect(calc.deductions.pension).toBe(115_800);
    expect(calc.employer_costs.health).toBe(246_075); // 2.895.000 × 8,5%

    // Withholding base = IBC (salary income), not vacations/incapacities
    expect(calc.deductions.retention_details).toEqual(
      calculateLaborWithholding({
        taxable_earnings: ibc,
        health_deduction: calc.deductions.health,
        pension_deduction: calc.deductions.pension,
        uvt_value: UVT_2026,
        year: 2026,
      }),
    );

    // Deduction novelty flows into other_deductions and the totals
    expect(calc.deductions.other_deductions).toEqual([
      { description: 'Novedad #6', amount: 50_000 },
    ]);
    // 2.300.000 + 200.000 (transport) + 595.000 (salary novelties)
    // + 383.333,33 (vacation) + 153.341 (incapacity)
    expect(calc.total_earnings).toBeCloseTo(3_631_674.33, 2);
    expect(calc.total_deductions).toBe(115_800 + 115_800 + 50_000);
    expect(calc.net_pay).toBeCloseTo(
      calc.total_earnings - calc.total_deductions,
      2,
    );
  });

  it('reduces worked_days with unpaid leave BEFORE proration', () => {
    const service = createService();

    const calc = service.calculateEmployeePayroll(
      employee(),
      30,
      rules,
      0,
      UVT_2026,
      2026,
      [valuate({ id: 9, novelty_type: 'leave_unpaid', days: 5 })],
    );

    expect(calc.worked_days).toBe(25);
    expect(calc.earnings.base_salary).toBe(1_916_666.67); // 2.300.000 × 25/30
    expect(calc.earnings.transport_subsidy).toBe(166_666.67); // 200.000 × 25/30
    expect(calc.earnings.licenses).toEqual([
      {
        start_date: '2026-06-05',
        end_date: '2026-06-05',
        quantity: 5,
        type: 'no_remunerada',
        payment: 0,
      },
    ]);
  });

  it('keeps historical behavior when there are no novelties (no DSPNE keys)', () => {
    const service = createService();

    const calc = service.calculateEmployeePayroll(
      employee(),
      30,
      rules,
      0,
      UVT_2026,
      2026,
    );

    expect(calc.earnings).toEqual({
      base_salary: 2_300_000,
      transport_subsidy: 200_000,
      total: 2_500_000,
    });
    expect(calc.deductions.other_deductions).toBeUndefined();
  });

  it('calculateForRun re-attaches applied novelties on recalculation without duplicating them', async () => {
    const period_start = new Date('2026-06-01');
    const period_end = new Date('2026-06-30');
    const novelty_row = {
      id: 1,
      employee_id: 700,
      novelty_type: 'overtime_nocturna',
      hours: new Prisma.Decimal(10),
      days: null,
      percentage: null,
      amount: null,
      date_start: new Date('2026-06-05'),
      date_end: null,
    };

    const created_items: any[] = [];
    const tx = {
      payroll_items: {
        deleteMany: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockImplementation(({ data }: any) => {
          created_items.push(data);
          return Promise.resolve({ id: created_items.length, ...data });
        }),
      },
      payroll_runs: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      employees: { findMany: jest.fn().mockResolvedValue([employee()]) },
      payroll_runs: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 55, accounting_entity_id: 9 }),
      },
      payroll_novelties: { findMany: jest.fn() },
      payroll_items: { findFirst: jest.fn() },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    };
    const advances = {
      calculateDeductionForPayroll: jest.fn().mockResolvedValue(0),
      applyPayrollDeduction: jest.fn(),
    };
    const rules_service = {
      getUvtValueForYear: jest.fn().mockResolvedValue(UVT_2026),
    };
    const novelties_service = {
      findPendingForPeriod: jest.fn(),
      attachToRun: jest.fn().mockResolvedValue(undefined),
      releaseFromRun: jest.fn().mockResolvedValue(undefined),
    };

    const service = new PayrollCalculationService(
      prisma,
      advances as any,
      rules_service as any,
      novelties_service as any,
    );

    // 1st calculation: the novelty is pending
    novelties_service.findPendingForPeriod.mockResolvedValueOnce([
      { ...novelty_row, status: 'pending', payroll_run_id: null },
    ]);
    prisma.payroll_novelties.findMany.mockResolvedValueOnce([]);

    await service.calculateForRun(55, period_start, period_end, null, rules);

    expect(novelties_service.releaseFromRun).toHaveBeenCalledWith(55, tx);
    expect(novelties_service.attachToRun).toHaveBeenCalledWith(tx, [1], 55);
    expect(created_items).toHaveLength(1);
    expect(created_items[0].earnings.overtime).toEqual([
      { type: 'HEN', hours: 10, percentage: 75, amount: 175_000 },
    ]);

    // 2nd calculation (recalc): the novelty is now applied to THIS run —
    // it must be re-valuated exactly once, never duplicated.
    novelties_service.findPendingForPeriod.mockResolvedValueOnce([]);
    prisma.payroll_novelties.findMany.mockResolvedValueOnce([
      { ...novelty_row, status: 'applied', payroll_run_id: 55 },
    ]);

    await service.calculateForRun(55, period_start, period_end, null, rules);

    expect(created_items).toHaveLength(2);
    expect(created_items[1].earnings.overtime).toEqual([
      { type: 'HEN', hours: 10, percentage: 75, amount: 175_000 },
    ]);
    expect(novelties_service.attachToRun).toHaveBeenLastCalledWith(
      tx,
      [1],
      55,
    );
    expect(novelties_service.releaseFromRun).toHaveBeenCalledTimes(2);
  });
});
