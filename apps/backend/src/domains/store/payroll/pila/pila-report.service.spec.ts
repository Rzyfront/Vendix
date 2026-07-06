import { PilaReportService } from './pila-report.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  PILA_TYPE1_TOTAL_LENGTH,
  PILA_TYPE2_TOTAL_LENGTH,
} from './pila-flat-file.layout';

describe('PilaReportService', () => {
  const employeeAda = {
    id: 700,
    first_name: 'Ada Grace',
    last_name: 'Lovelace Byron',
    document_type: 'CC',
    document_number: '111',
    arl_risk_level: 1,
    salary_type: 'ordinary',
    hire_date: null,
    termination_date: null,
  };

  const employeeAlan = {
    id: 701,
    first_name: 'Alan',
    last_name: 'Turing',
    document_type: 'CC',
    document_number: '222',
    arl_risk_level: 2,
    salary_type: 'integral',
    hire_date: null,
    termination_date: null,
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
    prevItems: any[] = [],
  ) => {
    const submissionClient = {
      pila_submissions: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (cb: any) =>
        cb({
          pila_submissions: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            create: jest.fn().mockResolvedValue({}),
          },
        }),
      ),
    };

    // payroll_items.findMany se invoca para el período actual y para el
    // período anterior (VSP). La 1a llamada devuelve los items del período,
    // la 2a los del período anterior.
    const itemsFindMany = jest
      .fn()
      .mockResolvedValueOnce(items)
      .mockResolvedValue(prevItems);

    const prisma = {
      payroll_runs: { findMany: jest.fn().mockResolvedValue(runs) },
      payroll_items: { findMany: itemsFindMany },
      payroll_novelties: { findMany: jest.fn().mockResolvedValue(novelties) },
      withoutScope: jest.fn().mockReturnValue(submissionClient),
    };

    const fiscalScope = {
      resolveAccountingEntityForFiscal: jest.fn().mockResolvedValue({
        id: 1,
        legal_name: 'ACME SAS',
        name: 'ACME',
        tax_id: '900123456-7',
      }),
    };

    const payrollRules = {
      getRulesForYear: jest.fn().mockResolvedValue({ minimum_wage: 1423500 }),
    };

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: 1, store_id: null, user_id: 1 } as any);

    return {
      service: new PilaReportService(
        prisma as any,
        fiscalScope as any,
        payrollRules as any,
      ),
      prisma,
      fiscalScope,
      payrollRules,
    };
  };

  afterEach(() => jest.restoreAllMocks());

  it('aggregates contributions for two employees with totals', async () => {
    const { service } = createService();

    const report = await service.getContributionsForPeriod(2026, 5);

    expect(report.year).toBe(2026);
    expect(report.month).toBe(5);
    expect(report.employees).toHaveLength(2);

    const ada = report.employees.find((e) => e.employee_id === 700)!;
    const alan = report.employees.find((e) => e.employee_id === 701)!;

    expect(ada.full_name).toBe('Ada Grace Lovelace Byron');
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
    expect(alan.salary_type).toBe('integral');

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

  it('applies the IBC legal floor (1 SMMLV) and ceiling (25 SMMLV)', async () => {
    const lowItem = {
      ...itemAda,
      base_salary: 500000,
      worked_days: 30,
      earnings: { base_salary: 500000, total: 500000 },
    };
    const highItem = {
      ...itemAlan,
      base_salary: 60000000,
      worked_days: 30,
      earnings: { base_salary: 60000000, total: 60000000 },
    };
    const { service } = createService([lowItem, highItem]);

    const report = await service.getContributionsForPeriod(2026, 5);
    const low = report.employees.find((e) => e.employee_id === 700)!;
    const high = report.employees.find((e) => e.employee_id === 701)!;

    expect(low.ibc).toBe(1423500); // piso 1 SMMLV
    expect(high.ibc).toBe(1423500 * 25); // techo 25 SMMLV
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
      ingreso: false,
      retiro: false,
      salary_variation_permanent: false,
      salary_variation_transitory: false,
      maternity_leave: false,
    });
    expect(alan.novelty_flags.unpaid_leave).toBe(true);
  });

  it('derives ING/RET from hire/termination dates in the period', async () => {
    const hired = {
      ...itemAda,
      employee: {
        ...employeeAda,
        hire_date: new Date(Date.UTC(2026, 4, 10)),
        termination_date: null,
      },
    };
    const { service } = createService([hired]);

    const report = await service.getContributionsForPeriod(2026, 5);
    const emp = report.employees[0];

    expect(emp.novelty_flags.ingreso).toBe(true);
    expect(emp.novelty_dates.ingreso).toBe('2026-05-10');
    expect(emp.novelty_flags.retiro).toBe(false);
  });

  it('flags VSP when base salary changed vs previous period', async () => {
    const prev = [{ employee_id: 700, base_salary: 1800000 }];
    const { service } = createService([itemAda], [], [{ id: 50 }], prev);

    const report = await service.getContributionsForPeriod(2026, 5);
    const emp = report.employees[0];

    expect(emp.novelty_flags.salary_variation_permanent).toBe(true);
    expect(emp.novelty_dates.salary_variation_permanent_start).toBe(
      '2026-05-01',
    );
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
  });

  it('generates the official flat file with fixed-width type 1 and type 2 records', async () => {
    const { service } = createService();

    const { filename, content, cotizantes } = await service.generateFlatFile(
      2026,
      5,
    );

    expect(filename).toBe('pila_2026_05.txt');
    expect(cotizantes).toBe(2);

    const lines = content.replace(/\r\n$/, '').split('\r\n');
    // 1 encabezado (tipo 1) + 2 cotizantes (tipo 2)
    expect(lines).toHaveLength(3);

    // Registro tipo 1: longitud exacta 359, comienza con '01'
    expect(lines[0]).toHaveLength(PILA_TYPE1_TOTAL_LENGTH);
    expect(lines[0].startsWith('01')).toBe(true);

    // Registros tipo 2: longitud exacta 686, comienzan con '02'
    for (const detail of lines.slice(1)) {
      expect(detail).toHaveLength(PILA_TYPE2_TOTAL_LENGTH);
      expect(detail.startsWith('02')).toBe(true);
    }
  });

  it('returns an empty report when no runs exist in the period', async () => {
    const { service, prisma } = createService([], [], []);

    const report = await service.getContributionsForPeriod(2026, 5);

    expect(report.employees).toEqual([]);
    expect(report.totals.total).toBe(0);
    expect(prisma.payroll_items.findMany).not.toHaveBeenCalled();
  });
});
