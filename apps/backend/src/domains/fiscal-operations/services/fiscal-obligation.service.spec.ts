import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '@common/context/request-context.service';
import { FiscalObligationService } from './fiscal-obligation.service';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';

describe('FiscalObligationService', () => {
  const context: FiscalOperationsContext = {
    organization_id: 1,
    store_id: null,
    fiscal_scope: 'ORGANIZATION',
    operating_scope: 'ORGANIZATION',
    accounting_entity_id: 77,
    accounting_entity: { id: 77 },
  };

  const baseObligation = {
    id: 100,
    organization_id: 1,
    store_id: null,
    accounting_entity_id: 77,
    status: 'ready',
    evidence_id: null,
    notes: null,
    blocking_reason: null,
  };

  const requestContext = {
    user_id: 9,
    organization_id: 1,
    is_super_admin: false,
    is_owner: true,
  };

  const createService = (overrides: any = {}) => {
    const client = {
      fiscal_obligations: {
        findFirst: jest.fn().mockResolvedValue(baseObligation),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...baseObligation,
            ...data,
            evidence_id:
              data.evidence?.connect?.id ?? baseObligation.evidence_id,
          }),
        ),
      },
      fiscal_evidences: {
        findFirst: jest.fn().mockResolvedValue({ id: 500 }),
      },
      ...overrides,
    };
    const fiscalStatus = { getStatusBlock: jest.fn() };
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
    const audit = { logForResource: jest.fn().mockResolvedValue(undefined) };

    return {
      service: new FiscalObligationService(
        client as any,
        fiscalStatus as any,
        eventEmitter,
        audit as any,
      ),
      client,
      eventEmitter,
      audit,
    };
  };

  it('requires evidence before moving an obligation to submitted', async () => {
    const { service, client } = createService();

    await expect(
      service.updateStatus([context], 100, { status: 'submitted' }),
    ).rejects.toThrow(BadRequestException);
    expect(client.fiscal_obligations.update).not.toHaveBeenCalled();
  });

  it('rejects evidence from another fiscal accounting entity', async () => {
    const { service, client } = createService({
      fiscal_evidences: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(
      service.updateStatus([context], 100, {
        status: 'submitted',
        evidence_id: 999,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(client.fiscal_evidences.findFirst).toHaveBeenCalledWith({
      where: {
        id: 999,
        organization_id: 1,
        accounting_entity_id: 77,
      },
      select: { id: true },
    });
    expect(client.fiscal_obligations.update).not.toHaveBeenCalled();
  });

  it('does not allow terminal obligations to move backwards', async () => {
    const { service } = createService({
      fiscal_obligations: {
        findFirst: jest.fn().mockResolvedValue({
          ...baseObligation,
          status: 'paid',
          evidence_id: 500,
        }),
        update: jest.fn(),
      },
      fiscal_evidences: {
        findFirst: jest.fn().mockResolvedValue({ id: 500 }),
      },
    });

    await expect(
      service.updateStatus([context], 100, { status: 'in_progress' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('updates status, emits event, and audits valid submitted transitions', async () => {
    const { service, client, eventEmitter, audit } = createService();

    const result = await RequestContextService.run(requestContext, () =>
      service.updateStatus([context], 100, {
        status: 'submitted',
        evidence_id: 500,
        notes: 'Presentada en portal DIAN',
      }),
    );

    expect(result).toMatchObject({
      status: 'submitted',
      evidence_id: 500,
      notes: 'Presentada en portal DIAN',
    });
    expect(client.fiscal_obligations.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: expect.objectContaining({
        status: 'submitted',
        evidence: { connect: { id: 500 } },
        notes: 'Presentada en portal DIAN',
      }),
      include: { accounting_entity: true, store: true, evidence: true },
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'fiscal.obligation.status_changed',
      expect.objectContaining({
        id: 100,
        status: 'submitted',
        accounting_entity_id: 77,
      }),
    );
    expect(audit.logForResource).toHaveBeenCalledWith(
      expect.objectContaining({ id: 100 }),
      expect.objectContaining({
        event_type: 'fiscal.obligation.status_changed',
        previous_status: 'ready',
        new_status: 'submitted',
        evidence_id: 500,
      }),
    );
  });

  describe('role-aware withholding obligation generation', () => {
    const accountingOnlyStatus = {
      fiscal_status: {
        invoicing: { state: 'INACTIVE' },
        accounting: { state: 'ACTIVE' },
        payroll: { state: 'INACTIVE' },
      },
    };

    const createGenerationService = (
      groupByResult: any[],
      overrides: any = {},
    ) => {
      const client = {
        fiscal_obligations: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation(({ data }) =>
            Promise.resolve({ id: 1, status: 'pending', ...data }),
          ),
          update: jest.fn(),
        },
        withholding_calculations: {
          groupBy: jest.fn().mockResolvedValue(groupByResult),
        },
        employees: {
          count: jest.fn().mockResolvedValue(0),
        },
        organization_settings: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
        store_settings: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
        ...overrides,
      };
      const fiscalStatus = {
        getStatusBlock: jest.fn().mockResolvedValue(accountingOnlyStatus),
      };
      const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
      const audit = { logForResource: jest.fn().mockResolvedValue(undefined) };

      return {
        service: new FiscalObligationService(
          client as any,
          fiscalStatus as any,
          eventEmitter,
          audit as any,
        ),
        client,
        fiscalStatus,
      };
    };

    const generatedTypes = (client: any): string[] =>
      client.fiscal_obligations.create.mock.calls.map(
        ([args]: any[]) => args.data.type,
      );

    it('only generates withholding_return when the period has practiced retefuente', async () => {
      const { service, client } = createGenerationService([
        { withholding_type: 'retefuente', _count: { _all: 2 } },
      ]);

      await RequestContextService.run(requestContext, () =>
        service.generateForContext(context, {
          period_year: 2026,
          period_month: 4,
        }),
      );

      const types = generatedTypes(client);
      expect(types).toContain('withholding_return');
      expect(types).not.toContain('reteiva_return');
      expect(types).not.toContain('reteica_return');
      expect(types).toContain('ica_return');
      expect(client.withholding_calculations.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['withholding_type'],
          where: expect.objectContaining({
            accounting_entity_id: 77,
            role: 'practiced',
          }),
        }),
      );
    });

    it('generates no withholding returns when the period has no practiced withholdings', async () => {
      const { service, client } = createGenerationService([]);

      await RequestContextService.run(requestContext, () =>
        service.generateForContext(context, {
          period_year: 2026,
          period_month: 4,
        }),
      );

      const types = generatedTypes(client);
      expect(types).not.toContain('withholding_return');
      expect(types).not.toContain('reteiva_return');
      expect(types).not.toContain('reteica_return');
      expect(types).toContain('ica_return');
    });

    it('conservatively generates the three withholding returns for untyped legacy rows', async () => {
      const { service, client } = createGenerationService([
        { withholding_type: null, _count: { _all: 1 } },
      ]);

      await RequestContextService.run(requestContext, () =>
        service.generateForContext(context, {
          period_year: 2026,
          period_month: 4,
        }),
      );

      const types = generatedTypes(client);
      expect(types).toContain('withholding_return');
      expect(types).toContain('reteiva_return');
      expect(types).toContain('reteica_return');
    });

    it('skips the role-aware lookup when explicit types are requested', async () => {
      const { service, client, fiscalStatus } = createGenerationService([]);

      await RequestContextService.run(requestContext, () =>
        service.generateForContext(context, {
          period_year: 2026,
          period_month: 4,
          types: ['vat_return'],
        }),
      );

      expect(client.withholding_calculations.groupBy).not.toHaveBeenCalled();
      expect(fiscalStatus.getStatusBlock).not.toHaveBeenCalled();
      expect(generatedTypes(client)).toEqual(['vat_return']);
    });
  });

  describe('responsibility-conditioned obligation generation (RUT casilla 53)', () => {
    const invoicingActiveStatus = {
      fiscal_status: {
        invoicing: { state: 'ACTIVE' },
        accounting: { state: 'INACTIVE' },
        payroll: { state: 'INACTIVE' },
      },
    };

    const createInvoicingService = (fiscalData: any) => {
      const client = {
        fiscal_obligations: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation(({ data }) =>
            Promise.resolve({ id: 1, status: 'pending', ...data }),
          ),
          update: jest.fn(),
        },
        withholding_calculations: {
          groupBy: jest.fn().mockResolvedValue([]),
        },
        employees: {
          count: jest.fn().mockResolvedValue(0),
        },
        organization_settings: {
          findUnique: jest.fn().mockResolvedValue(
            fiscalData === undefined
              ? null
              : { settings: { fiscal_data: fiscalData } },
          ),
        },
        store_settings: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      };
      const fiscalStatus = {
        getStatusBlock: jest.fn().mockResolvedValue(invoicingActiveStatus),
      };
      const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
      const audit = { logForResource: jest.fn().mockResolvedValue(undefined) };

      return {
        service: new FiscalObligationService(
          client as any,
          fiscalStatus as any,
          eventEmitter,
          audit as any,
        ),
        client,
      };
    };

    const generatedTypes = (client: any): string[] =>
      client.fiscal_obligations.create.mock.calls.map(
        ([args]: any[]) => args.data.type,
      );

    const generate = (
      service: FiscalObligationService,
      period_month: number,
    ) =>
      RequestContextService.run(requestContext, () =>
        service.generateForContext(context, {
          period_year: 2026,
          period_month,
        }),
      );

    it('excludes vat_return and inc_return when responsibilities lack O-48', async () => {
      const { service, client } = createInvoicingService({
        tax_responsibilities: ['O-13'],
      });

      await generate(service, 4);

      const types = generatedTypes(client);
      expect(types).not.toContain('vat_return');
      expect(types).not.toContain('inc_return');
      expect(types).toContain('electronic_invoice_review');
      expect(types).toContain('support_document_review');
    });

    it('skips vat_return on odd months for O-48 with default bimonthly periodicity', async () => {
      const { service, client } = createInvoicingService({
        tax_responsibilities: ['O-48'],
      });

      await generate(service, 3);

      const types = generatedTypes(client);
      expect(types).not.toContain('vat_return');
      expect(types).toContain('inc_return');
    });

    it('generates vat_return on even months for O-48 with default bimonthly periodicity', async () => {
      const { service, client } = createInvoicingService({
        tax_responsibilities: ['O-48'],
      });

      await generate(service, 4);

      const types = generatedTypes(client);
      expect(types).toContain('vat_return');
      expect(types).toContain('inc_return');
    });

    it('keeps the legacy defaults when responsibilities are absent or empty', async () => {
      for (const fiscalData of [
        undefined,
        {},
        { tax_responsibilities: [] },
      ]) {
        const { service, client } = createInvoicingService(fiscalData);

        await generate(service, 3);

        const types = generatedTypes(client);
        expect(types).toContain('vat_return');
        expect(types).toContain('inc_return');
      }
    });

    it('generates vat_return every month for O-48 with monthly periodicity', async () => {
      for (const month of [1, 2, 3, 7, 11]) {
        const { service, client } = createInvoicingService({
          tax_responsibilities: ['O-48'],
          vat_periodicity: 'monthly',
        });

        await generate(service, month);

        expect(generatedTypes(client)).toContain('vat_return');
      }
    });

    it('limits vat_return to april/august/december for O-48 with four_monthly periodicity', async () => {
      const expectations: Array<[number, boolean]> = [
        [4, true],
        [6, false],
        [8, true],
        [12, true],
      ];

      for (const [month, expected] of expectations) {
        const { service, client } = createInvoicingService({
          tax_responsibilities: ['O-48'],
          vat_periodicity: 'four_monthly',
        });

        await generate(service, month);

        if (expected) {
          expect(generatedTypes(client)).toContain('vat_return');
        } else {
          expect(generatedTypes(client)).not.toContain('vat_return');
        }
      }
    });

    it('reads fiscal_data from store_settings when the fiscal scope is STORE', async () => {
      const storeContext: FiscalOperationsContext = {
        ...context,
        store_id: 5,
        fiscal_scope: 'STORE',
        operating_scope: 'ORGANIZATION',
      };
      const { service, client } = createInvoicingService(undefined);
      client.store_settings.findUnique.mockResolvedValue({
        settings: { fiscal_data: { tax_responsibilities: ['O-49'] } },
      });

      await RequestContextService.run(requestContext, () =>
        service.generateForContext(storeContext, {
          period_year: 2026,
          period_month: 4,
        }),
      );

      expect(client.store_settings.findUnique).toHaveBeenCalledWith({
        where: { store_id: 5 },
        select: { settings: true },
      });
      expect(client.organization_settings.findUnique).not.toHaveBeenCalled();
      const types = generatedTypes(client);
      expect(types).not.toContain('vat_return');
      expect(types).not.toContain('inc_return');
    });
  });
});
