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
      withholding_concepts: {
        findFirst: jest.fn().mockResolvedValue({
          id: 33,
          code: 'RTE_SALARIOS',
          name: 'Salarios y pagos laborales',
          rate: 0.01,
        }),
      },
      uvt_values: {
        findFirst: jest.fn().mockResolvedValue({ value_cop: 49799 }),
      },
      withholding_calculations: {
        create: jest.fn().mockResolvedValue({ id: 900 }),
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

  describe('labor withholding persistence on DIAN acceptance', () => {
    const requestContext = {
      user_id: 9,
      organization_id: 1,
      store_id: 2,
      is_owner: false,
      is_super_admin: false,
    };

    const twoItemsRun = (overrides: any = {}) =>
      runFixture({
        payroll_items: [
          {
            id: 500,
            employee_id: 700,
            base_salary: 5200000,
            worked_days: 30,
            earnings: { base_salary: 5200000, transport_subsidy: 0, total: 5200000 },
            deductions: {
              health: 208000,
              pension: 208000,
              retention: 52000,
              advance_deduction: 0,
              total: 468000,
            },
            employer_costs: { total: 1000000 },
            net_pay: 4732000,
            total_earnings: 5200000,
            total_employer_costs: 1000000,
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
          {
            id: 501,
            employee_id: 701,
            base_salary: 1300000,
            worked_days: 30,
            earnings: { base_salary: 1300000, transport_subsidy: 162000, total: 1462000 },
            deductions: {
              health: 52000,
              pension: 52000,
              retention: 0,
              advance_deduction: 0,
              total: 104000,
            },
            employer_costs: { total: 280000 },
            net_pay: 1358000,
            total_earnings: 1462000,
            total_employer_costs: 280000,
            employee: {
              id: 701,
              employee_code: 'E-2',
              document_type: 'CC',
              document_number: '456',
              first_name: 'Grace',
              last_name: 'Hopper',
              cost_center: 'administrative',
            },
          },
        ],
        ...overrides,
      });

    const providerOk = {
      success: true,
      cune: 'cune-1',
      message: 'accepted',
      raw_response: {
        results: [
          { employee_document: '123', success: true, cune: 'cune-1' },
          { employee_document: '456', success: true, cune: 'cune-2' },
        ],
      },
    };

    it('creates exactly one withholding_calculation for the item with retention > 0', async () => {
      const run = twoItemsRun();
      const { service, prisma } = createService(run, providerOk);

      await RequestContextService.run(requestContext, () =>
        service.send(run.id),
      );

      expect(prisma.withholding_calculations.create).toHaveBeenCalledTimes(1);
      const args = prisma.withholding_calculations.create.mock.calls[0][0];
      expect(args.data).toMatchObject({
        organization_id: 1,
        store_id: 2,
        accounting_entity_id: 77,
        invoice_id: null,
        supplier_id: null,
        customer_id: null,
        concept_id: 33,
        role: 'practiced',
        counterparty_type: 'employee',
        withholding_type: 'retefuente',
        year: 2026,
      });
      expect(Number(args.data.base_amount)).toBe(5200000);
      expect(Number(args.data.withholding_amount)).toBe(52000);
      expect(Number(args.data.withholding_rate)).toBe(0.01);
      expect(Number(args.data.uvt_value_used)).toBe(49799);
    });

    it('uses base_depurada and marginal_rate when the art. 383 retention_details exist', async () => {
      const retention_details = {
        retention: 365600,
        base_depurada: 6900000,
        base_uvt: 131.74,
        exempt_amount: 2300000,
        marginal_rate: 0.19,
        uvt_value: 52374,
        method: 'art383_proc1',
      };
      const run = twoItemsRun();
      run.payroll_items[0].earnings = {
        base_salary: 10000000,
        transport_subsidy: 0,
        total: 10000000,
      };
      run.payroll_items[0].deductions = {
        health: 400000,
        pension: 400000,
        retention: 365600,
        advance_deduction: 0,
        total: 1165600,
        retention_details,
      };
      const { service, prisma } = createService(run, providerOk);

      await RequestContextService.run(requestContext, () =>
        service.send(run.id),
      );

      expect(prisma.withholding_calculations.create).toHaveBeenCalledTimes(1);
      const args = prisma.withholding_calculations.create.mock.calls[0][0];
      expect(Number(args.data.base_amount)).toBe(6900000);
      expect(Number(args.data.withholding_rate)).toBe(0.19);
      expect(Number(args.data.withholding_amount)).toBe(365600);
    });

    it('skips creation when the run was already DIAN-accepted (re-emission guard)', async () => {
      // Realistic duplicate path: send() already set dian_status='accepted',
      // a later getDianStatus poll transitions sent -> accepted again.
      const run = twoItemsRun({
        status: 'sent',
        dian_status: 'accepted',
        cune: 'cune-1',
      });
      const { service, prisma } = createService(run);
      (service as any).dian_payroll_provider.checkStatus = jest
        .fn()
        .mockResolvedValue({ status: 'accepted' });

      await RequestContextService.run(requestContext, () =>
        service.getDianStatus(run.id),
      );

      expect(prisma.withholding_calculations.create).not.toHaveBeenCalled();
    });

    it('does not fail the acceptance when the labor concept is missing', async () => {
      const run = twoItemsRun();
      const { service, prisma, eventEmitter } = createService(run, providerOk);
      prisma.withholding_concepts.findFirst.mockResolvedValue(null);

      await RequestContextService.run(requestContext, () =>
        service.send(run.id),
      );

      expect(prisma.withholding_calculations.create).not.toHaveBeenCalled();
      // Acceptance flow still completes and emits accounting event
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payroll.dian_accepted',
        expect.objectContaining({ payroll_run_id: 50 }),
      );
    });
  });
});
