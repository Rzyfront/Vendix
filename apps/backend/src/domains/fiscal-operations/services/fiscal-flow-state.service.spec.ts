import { FiscalFlowStateService, FlowStage } from './fiscal-flow-state.service';

type GroupRow = Record<string, unknown> & { _count: { _all: number } };

interface PrismaMockConfig {
  salesDian?: GroupRow[];
  salesAccounting?: GroupRow[];
  supportDian?: GroupRow[];
  retryPending?: number;
  withholdings?: GroupRow[];
  payrollStatus?: GroupRow[];
  payrollDian?: GroupRow[];
  payrollAccounting?: GroupRow[];
  draftEntries?: number;
  postedEntries?: number;
  declarations?: GroupRow[];
  obligations?: GroupRow[];
}

function group(key: string, value: string, count: number): GroupRow {
  return { [key]: value, _count: { _all: count } };
}

function buildPrisma(config: PrismaMockConfig = {}) {
  return {
    fiscal_transmissions: {
      groupBy: jest.fn().mockImplementation((args: any) => {
        if (args.by[0] === 'accounting_status') {
          return Promise.resolve(config.salesAccounting ?? []);
        }
        const types: string[] = args.where.document_type.in;
        if (types.includes('sales_invoice')) {
          return Promise.resolve(config.salesDian ?? []);
        }
        return Promise.resolve(config.supportDian ?? []);
      }),
    },
    invoice_retry_queue: {
      count: jest.fn().mockResolvedValue(config.retryPending ?? 0),
    },
    withholding_calculations: {
      groupBy: jest.fn().mockResolvedValue(config.withholdings ?? []),
    },
    payroll_runs: {
      groupBy: jest.fn().mockImplementation((args: any) => {
        if (args.by[0] === 'status') {
          return Promise.resolve(config.payrollStatus ?? []);
        }
        if (args.by[0] === 'dian_status') {
          return Promise.resolve(config.payrollDian ?? []);
        }
        return Promise.resolve(config.payrollAccounting ?? []);
      }),
    },
    accounting_entries: {
      count: jest.fn().mockImplementation((args: any) => {
        if (args.where.status === 'draft') {
          return Promise.resolve(config.draftEntries ?? 0);
        }
        return Promise.resolve(config.postedEntries ?? 0);
      }),
    },
    tax_declaration_drafts: {
      groupBy: jest.fn().mockResolvedValue(config.declarations ?? []),
    },
    fiscal_obligations: {
      groupBy: jest.fn().mockResolvedValue(config.obligations ?? []),
    },
  };
}

function buildFiscalStatus(states: {
  invoicing?: string;
  accounting?: string;
  payroll?: string;
}) {
  return {
    getStatusBlock: jest.fn().mockResolvedValue({
      fiscal_scope: 'STORE',
      store_id: 2,
      source_exists: true,
      fiscal_status: {
        invoicing: { state: states.invoicing ?? 'ACTIVE' },
        accounting: { state: states.accounting ?? 'ACTIVE' },
        payroll: { state: states.payroll ?? 'ACTIVE' },
      },
    }),
  };
}

function buildCloseService(preview: {
  session_id?: number | null;
  session_status?: string | null;
  checks?: Array<{
    check_key: string;
    title: string;
    blocking: boolean;
    status: string;
    result_summary: string | null;
  }>;
}) {
  return {
    previewChecks: jest.fn().mockResolvedValue({
      session_id: preview.session_id ?? null,
      session_status: preview.session_status ?? null,
      checks: preview.checks ?? [],
    }),
  };
}

function stageByKey(stages: FlowStage[], key: string): FlowStage {
  const stage = stages.find((item) => item.key === key);
  if (!stage) throw new Error(`Stage ${key} not found`);
  return stage;
}

describe('FiscalFlowStateService getFlowState', () => {
  const context = {
    organization_id: 1,
    store_id: 2,
    fiscal_scope: 'STORE',
    operating_scope: 'STORE',
    accounting_entity_id: 77,
    accounting_entity: { id: 77 },
  } as any;
  const query = { year: 2026, month: 5 } as any;

  it('marks DIAN sales stage as blocked when the period has rejected transmissions', async () => {
    const prisma = buildPrisma({
      salesDian: [
        group('dian_status', 'accepted', 3),
        group('dian_status', 'rejected', 2),
        group('dian_status', 'pending', 1),
      ],
      salesAccounting: [group('accounting_status', 'posted', 3)],
      retryPending: 1,
    });
    const closeService = buildCloseService({
      checks: [
        {
          check_key: 'dian_invoices_all_accepted',
          title: 'Facturación DIAN aceptada',
          blocking: true,
          status: 'failed',
          result_summary: 'Revisión pendiente: 3',
        },
        {
          check_key: 'journal_entries_posted',
          title: 'Asientos contabilizados',
          blocking: true,
          status: 'passed',
          result_summary: 'Sin hallazgos bloqueantes',
        },
      ],
    });
    const service = new FiscalFlowStateService(
      prisma as any,
      buildFiscalStatus({}) as any,
      closeService as any,
    );

    const result = await service.getFlowState([context], query);

    expect(result.period).toEqual({
      year: 2026,
      month: 5,
      start_date: '2026-05-01T00:00:00.000Z',
      end_date: '2026-05-31T00:00:00.000Z',
    });

    const dian = stageByKey(result.flows.sales.stages, 'dian');
    expect(dian.status).toBe('blocked');
    expect(dian.counts).toMatchObject({
      accepted: 3,
      rejected: 2,
      pending: 1,
      retry_pending: 1,
    });

    const emission = stageByKey(result.flows.sales.stages, 'emission');
    expect(emission.status).toBe('ok');
    expect(emission.counts.total).toBe(6);

    expect(result.convergence.close.status).toBe('blocked');
    expect(result.convergence.close.checks_summary).toEqual({
      total: 2,
      passed: 1,
      failed: 1,
      warnings: 0,
    });
    expect(closeService.previewChecks).toHaveBeenCalledWith(context, 2026, 5);
  });

  it('marks every stage as ok when the whole period is accepted and posted', async () => {
    const prisma = buildPrisma({
      salesDian: [group('dian_status', 'accepted', 5)],
      salesAccounting: [group('accounting_status', 'posted', 5)],
      supportDian: [group('dian_status', 'accepted', 2)],
      withholdings: [group('withholding_type', 'retefuente', 2)],
      payrollStatus: [group('status', 'paid', 1)],
      payrollDian: [group('dian_status', 'accepted', 1)],
      payrollAccounting: [group('accounting_status', 'posted', 1)],
      draftEntries: 0,
      postedEntries: 12,
      declarations: [group('status', 'accepted', 1)],
      obligations: [group('status', 'paid', 2)],
    });
    const closeService = buildCloseService({
      session_id: 9,
      session_status: 'closed',
      checks: [
        {
          check_key: 'journal_entries_posted',
          title: 'Asientos contabilizados',
          blocking: true,
          status: 'passed',
          result_summary: 'Sin hallazgos bloqueantes',
        },
      ],
    });
    const service = new FiscalFlowStateService(
      prisma as any,
      buildFiscalStatus({}) as any,
      closeService as any,
    );

    const result = await service.getFlowState([context], query);

    for (const stage of result.flows.sales.stages) {
      expect(stage.status).toBe('ok');
    }
    for (const stage of result.flows.purchases.stages) {
      expect(stage.status).toBe('ok');
    }
    for (const stage of result.flows.payroll.stages) {
      expect(stage.status).toBe('ok');
    }
    expect(result.convergence.journal.status).toBe('ok');
    expect(result.convergence.journal.counts).toEqual({ draft: 0, posted: 12 });
    expect(result.convergence.declarations.status).toBe('ok');
    expect(result.convergence.obligations.status).toBe('ok');
    expect(result.convergence.close.status).toBe('ok');
    expect(result.convergence.close.counts).toMatchObject({
      sessions: 1,
      closed_sessions: 1,
    });
  });

  it('marks payroll stages as not_applicable when the payroll fiscal area is inactive', async () => {
    const prisma = buildPrisma({
      salesDian: [group('dian_status', 'accepted', 1)],
      salesAccounting: [group('accounting_status', 'posted', 1)],
      // Aunque existan filas de nómina, el área inactiva manda.
      payrollStatus: [group('status', 'draft', 3)],
      payrollDian: [group('dian_status', 'pending', 3)],
      payrollAccounting: [group('accounting_status', 'blocked', 3)],
    });
    const closeService = buildCloseService({ checks: [] });
    const service = new FiscalFlowStateService(
      prisma as any,
      buildFiscalStatus({ payroll: 'INACTIVE' }) as any,
      closeService as any,
    );

    const result = await service.getFlowState([context], query);

    for (const stage of result.flows.payroll.stages) {
      expect(stage.status).toBe('not_applicable');
      expect(stage.counts).toEqual({});
    }
    // Los demás flujos no se ven afectados.
    expect(stageByKey(result.flows.sales.stages, 'dian').status).toBe('ok');
    expect(result.convergence.journal.status).toBe('empty');
  });

  it('marks invoicing-driven stages as not_applicable when invoicing is inactive', async () => {
    const prisma = buildPrisma({});
    const closeService = buildCloseService({ checks: [] });
    const service = new FiscalFlowStateService(
      prisma as any,
      buildFiscalStatus({ invoicing: 'INACTIVE' }) as any,
      closeService as any,
    );

    const result = await service.getFlowState([context], query);

    expect(stageByKey(result.flows.sales.stages, 'emission').status).toBe(
      'not_applicable',
    );
    expect(stageByKey(result.flows.sales.stages, 'dian').status).toBe(
      'not_applicable',
    );
    expect(
      stageByKey(result.flows.purchases.stages, 'support_documents').status,
    ).toBe('not_applicable');
    // Las etapas contables siguen activas (accounting ACTIVE).
    expect(stageByKey(result.flows.sales.stages, 'journal').status).toBe(
      'empty',
    );
  });
});
