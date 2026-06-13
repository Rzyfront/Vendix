import { PilaReportService } from './pila-report.service';

describe('PilaReportService', () => {
  const employeeAda = {
    id: 700,
    first_name: 'Ada',
    last_name: 'Lovelace',
    document_type: 'CC',
    document_number: '111',
    arl_risk_level: 1,
  };

  const employeeAlan = {
    id: 701,
    first_name: 'Alan',
    last_name: 'Turing',
    document_type: 'CC',
    document_number: '222',
    arl_risk_level: 2,
  };

  const itemAda = {
    id: 1,
    payroll_run_id: 50,
    employee_id: 700,
    base_salary: 2000000,
    worked_days: 30,
    earnings: {
      base_salary: 2000000,
      transport_subsidy: 200000, // NO debe sumar al IBC
      overtime: [
        { type: 'overtime_diurna', hours: 4, percentage: 0.25, amount: 50000 },
      ],
      bonuses: [{ taxable: 100000, non_taxable: 30000 }],
      commissions: 150000,
      total: 2530000,
    },
    deductions: { health: 92000, pension: 92000, retention: 0, total: 184000 },
    employer_costs: {
      health: 195500,
      pension: 276000,
      arl: 12006,
      sena: 46000,
      icbf: 69000,
      compensation_fund: 92000,
      total: 690506,
    },
    employee: employeeAda,
  };

  const itemAlan = {
    id: 2,
    payroll_run_id: 50,
    employee_id: 701,
    base_salary: 3000000,
    worked_days: 28,
    earnings: {
      base_salary: 3000000,
      transport_subsidy: 0,
      total: 3000000,
    },
    deductions: { health: 120000, pension: 120000, retention: 0, total: 240000 },
    employer_costs: {
      health: 255000,
      pension: 360000,
      arl: 31320,
      sena: 60000,
      icbf: 90000,
      compensation_fund: 120000,
      total: 916320,
    },
    employee: employeeAlan,
  };

  const createService = (
    items: any[] = [itemAda, itemAlan],
    novelties: any[] = [],
    runs: any[] = [{ id: 50 }],
  ) => {
    const prisma = {
      payroll_runs: {
        findMany: jest.fn().mockResolvedValue(runs),
      },
      payroll_items: {
        findMany: jest.fn().mockResolvedValue(items),
      },
      payroll_novelties: {
        findMany: jest.fn().mockResolvedValue(novelties),
      },
    };
    return { service: new PilaReportService(prisma as any), prisma };
  };

  it('aggregates contributions for two employees with totals', async () => {
    const { service } = createService();

    const report = await service.getContributionsForPeriod(2026, 5);

    expect(report.year).toBe(2026);
    expect(report.month).toBe(5);
    expect(report.employees).toHaveLength(2);

    const ada = report.employees.find((e) => e.employee_id === 700)!;
    const alan = report.employees.find((e) => e.employee_id === 701)!;

    expect(ada.full_name).toBe('Ada Lovelace');
    expect(ada.health_employee).toBe(92000);
    expect(ada.pension_employee).toBe(92000);
    expect(ada.health_employer).toBe(195500);
    expect(ada.pension_employer).toBe(276000);
    expect(ada.arl).toBe(12006);
    expect(ada.sena).toBe(46000);
    expect(ada.icbf).toBe(69000);
    expect(ada.compensation_fund).toBe(92000);
    expect(ada.total).toBe(
      92000 + 92000 + 195500 + 276000 + 12006 + 46000 + 69000 + 92000,
    );
    expect(ada.worked_days).toBe(30);
    expect(ada.arl_risk_level).toBe(1);

    expect(alan.ibc).toBe(3000000);
    expect(alan.worked_days).toBe(28);

    expect(report.totals.ibc).toBe(ada.ibc + alan.ibc);
    expect(report.totals.health_employee).toBe(92000 + 120000);
    expect(report.totals.total).toBe(ada.total + alan.total);
  });

  it('computes IBC from salary earnings WITHOUT transport subsidy', async () => {
    const { service } = createService([itemAda], [], [{ id: 50 }]);

    const report = await service.getContributionsForPeriod(2026, 5);

    // base 2.000.000 + overtime 50.000 + commissions 150.000 + bonus taxable 100.000
    expect(report.employees[0].ibc).toBe(2300000);
  });

  it('maps applied novelties to PILA flags per employee', async () => {
    const { service } = createService(
      [itemAda, itemAlan],
      [
        { employee_id: 700, novelty_type: 'vacation' },
        { employee_id: 700, novelty_type: 'incapacity_general' },
        { employee_id: 701, novelty_type: 'leave_unpaid' },
      ],
    );

    const report = await service.getContributionsForPeriod(2026, 5);

    const ada = report.employees.find((e) => e.employee_id === 700)!;
    const alan = report.employees.find((e) => e.employee_id === 701)!;

    expect(ada.novelty_flags).toEqual({
      vacation: true,
      incapacity_general: true,
      incapacity_laboral: false,
      unpaid_leave: false,
    });
    expect(alan.novelty_flags).toEqual({
      vacation: false,
      incapacity_general: false,
      incapacity_laboral: false,
      unpaid_leave: true,
    });
  });

  it('exports CSV with ";" separator, one row per employee and totals row', async () => {
    const { service } = createService();

    const { filename, content } = await service.exportCsv(2026, 5);

    expect(filename).toBe('pila_2026_05.csv');

    const lines = content.split('\r\n');
    // header + 2 employees + totals
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('tipo_documento;numero_documento');
    expect(lines[0].split(';')).toHaveLength(19);

    const adaLine = lines.find((l) => l.includes('Ada Lovelace'))!;
    expect(adaLine).toBeDefined();
    expect(adaLine.split(';')).toHaveLength(19);
    expect(adaLine).toContain('2300000.00');

    const totalsLine = lines[lines.length - 1];
    expect(totalsLine).toContain('TOTALES');
    expect(totalsLine).toContain((2300000 + 3000000).toFixed(2));
  });

  it('returns an empty report when no runs exist in the period', async () => {
    const { service, prisma } = createService([], [], []);

    const report = await service.getContributionsForPeriod(2026, 5);

    expect(report.employees).toEqual([]);
    expect(report.totals.total).toBe(0);
    expect(prisma.payroll_items.findMany).not.toHaveBeenCalled();
  });
});
