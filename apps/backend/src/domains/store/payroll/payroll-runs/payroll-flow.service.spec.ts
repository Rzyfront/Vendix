import { RequestContextService } from '../../../../common/context/request-context.service';
import { PayrollFlowService } from './payroll-flow.service';

describe('PayrollFlowService fiscal accounting gate', () => {
  const runFixture = (overrides: any = {}) => ({
    id: 50,
    organization_id: 1,
    store_id: 2,
    accounting_entity_id: 77,
    payroll_number: 'NOM-2026-0001',
    status: 'approved',
    period_start: new Date('2026-04-01T00:00:00Z'),
    period_end: new Date('2026-04-30T00:00:00Z'),
    total_earnings: 1000,
    total_employer_costs: 200,
    total_deductions: 100,
    total_net_pay: 900,
    health_deduction: 40,
    pension_deduction: 40,
    approved_by_user_id: 9,
    payroll_items: [
      {
        id: 500,
        employee_id: 700,
        base_salary: 1000,
        worked_days: 30,
        earnings: { total: 1000 },
        deductions: { total: 100 },
        employer_costs: { total: 200 },
        net_pay: 900,
        total_earnings: 1000,
        total_employer_costs: 200,
        employee: {
          id: 700,
          employee_code: 'E-1',
          document_type: 'CC',
          document_number: '123',
          first_name: 'Ada',
          last_name: 'Lovelace',
          cost_center: 'administrative',
        },
      },
    ],
    ...overrides,
  });

  const createService = (run: any, providerResponse: any = null) => {
    const prisma = {
      payroll_runs: {
        findFirst: jest.fn().mockResolvedValue(run),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...run,
            ...data,
          }),
        ),
      },
      payroll_items: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const eventEmitter = { emit: jest.fn() };
    const payrollProvider = {
      sendPayroll: jest.fn().mockResolvedValue(
        providerResponse ?? {
          success: true,
          cune: 'cune-1',
          message: 'accepted',
          raw_response: {
            results: [
              {
                employee_document: '123',
                success: true,
                cune: 'cune-employee-1',
              },
            ],
          },
        },
      ),
    };
    const dianProvider = {
      sendPayroll: jest.fn(),
      checkStatus: jest.fn(),
    };

    return {
      service: new PayrollFlowService(
        prisma as any,
        {} as any,
        {} as any,
        eventEmitter as any,
        payrollProvider as any,
        dianProvider as any,
      ),
      prisma,
      eventEmitter,
      payrollProvider,
    };
  };

  it('does not create fiscal accounting entries when payroll is only approved internally', async () => {
    const run = runFixture({ status: 'calculated' });
    const { service, eventEmitter } = createService(run);

    await RequestContextService.run(
      {
        user_id: 9,
        organization_id: 1,
        store_id: 2,
        is_owner: false,
        is_super_admin: false,
      },
      () => service.approve(run.id),
    );

    expect(eventEmitter.emit).not.toHaveBeenCalledWith(
      'payroll.approved',
      expect.anything(),
    );
    expect(eventEmitter.emit).not.toHaveBeenCalledWith(
      'payroll.dian_accepted',
      expect.anything(),
    );
  });

  it('emits fiscal accounting only after DIAN/provider acceptance', async () => {
    const run = runFixture();
    const { service, eventEmitter } = createService(run);

    await RequestContextService.run(
      {
        user_id: 9,
        organization_id: 1,
        store_id: 2,
        is_owner: false,
        is_super_admin: false,
      },
      () => service.send(run.id),
    );

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'payroll.dian_accepted',
      expect.objectContaining({
        payroll_run_id: 50,
        organization_id: 1,
        store_id: 2,
        accounting_entity_id: 77,
        approved_by: 9,
      }),
    );
  });
});
