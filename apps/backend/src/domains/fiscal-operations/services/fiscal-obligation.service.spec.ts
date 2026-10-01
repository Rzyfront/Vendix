import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '@common/context/request-context.service';
import { FiscalObligationService } from './fiscal-obligation.service';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';
import { FiscalTaxCalendarService } from './fiscal-tax-calendar.service';

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
        new FiscalTaxCalendarService(),
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
          new FiscalTaxCalendarService(),
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
          new FiscalTaxCalendarService(),
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
    });

    it('generates vat_return on even months for O-48 with default bimonthly periodicity', async () => {
      const { service, client } = createInvoicingService({
        tax_responsibilities: ['O-48'],
      });

      await generate(service, 4);

      const types = generatedTypes(client);
      expect(types).toContain('vat_return');
    });

    /**
     * QUI-INC — los dos ejes se separaron. Antes `inc_return` colgaba del
     * predicado de IVA, así que O-48 arrastraba una declaración de INC que el
     * contribuyente no debía, y O-33 sin O-48 no generaba la que sí debe.
     * Son responsabilidades distintas de la misma casilla 53 y se preguntan
     * por separado.
     */
    it('no genera inc_return para O-48 solo: ser responsable de IVA no obliga a declarar INC', async () => {
      const { service, client } = createInvoicingService({
        tax_responsibilities: ['O-48'],
      });

      await generate(service, 4);

      const types = generatedTypes(client);
      expect(types).toContain('vat_return');
      expect(types).not.toContain('inc_return');
    });

    it('genera inc_return (y NO vat_return) para O-33 sin O-48 — el restaurante del Art. 426 ET', async () => {
      const { service, client } = createInvoicingService({
        // Casilla 53 real de Pollo Árabe (store 105, producción).
        tax_responsibilities: [
          'O-05',
          'O-07',
          'O-14',
          'O-33',
          'O-42',
          'O-52',
          'O-55',
        ],
        // El régimen rancio que antes lo volvía responsable de IVA.
        tax_regime: 'COMUN',
      });

      await generate(service, 4);

      const types = generatedTypes(client);
      expect(types).toContain('inc_return');
      expect(types).not.toContain('vat_return');
    });

    /**
     * Sin ninguna señal fiscal el helper es fail-closed (`responsible: false`,
     * `indeterminate: true`), así que NO se generan declaraciones. La versión
     * previa de este caso afirmaba lo contrario —«indeterminado ⇒
     * responsable»— describiendo una rama anti-regresión que ya no existe, y
     * llevaba tiempo en rojo contra HEAD por eso.
     */
    it('no genera declaraciones cuando no hay ninguna señal fiscal declarada', async () => {
      for (const fiscalData of [
        undefined,
        {},
        { tax_responsibilities: [] },
      ]) {
        const { service, client } = createInvoicingService(fiscalData);

        await generate(service, 3);

        const types = generatedTypes(client);
        expect(types).not.toContain('vat_return');
        expect(types).not.toContain('inc_return');
        expect(types).toContain('electronic_invoice_review');
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

  describe('verified tax-calendar integration', () => {
    const makeCalendarService = (options: {
      nit?: string;
      responsibilities?: string[];
      existing?: any;
      stores?: boolean;
    } = {}) => {
      const obligationModel = {
        findFirst: jest.fn().mockResolvedValue(options.existing ?? null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 15, ...data }),
        ),
        update: jest.fn().mockImplementation(({ where, data }) =>
          Promise.resolve({ id: where.id, ...options.existing, ...data }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
      };
      const settings = {
        fiscal_data: {
          ...(options.nit ? { nit: options.nit } : {}),
          ...(options.responsibilities
            ? { tax_responsibilities: options.responsibilities }
            : {}),
        },
      };
      const client = {
        fiscal_obligations: obligationModel,
        withholding_calculations: { groupBy: jest.fn().mockResolvedValue([]) },
        employees: { count: jest.fn().mockResolvedValue(0) },
        organization_settings: {
          findUnique: jest.fn().mockResolvedValue(
            options.stores ? null : { settings },
          ),
        },
        store_settings: {
          findUnique: jest.fn().mockResolvedValue(
            options.stores ? { settings } : null,
          ),
        },
      };
      const fiscalStatus = { getStatusBlock: jest.fn() };
      const audit = { logForResource: jest.fn().mockResolvedValue(undefined) };
      const service = new FiscalObligationService(
        client as any,
        fiscalStatus as any,
        { emit: jest.fn() } as unknown as EventEmitter2,
        audit as any,
        new FiscalTaxCalendarService(),
      );
      return { service, client, obligationModel };
    };

    it('uses a verified monthly withholding deadline and stores the resolved range', async () => {
      const { service, obligationModel } = makeCalendarService({ nit: '123456781' });
      const [created] = await service.generateForContext(context, {
        period_year: 2026,
        period_month: 1,
        periodicity: 'monthly',
        types: ['withholding_return'],
      });

      expect(created).toMatchObject({
        period_start: new Date('2026-01-01T00:00:00.000Z'),
        period_end: new Date('2026-01-31T00:00:00.000Z'),
        periodicity: 'monthly',
        due_date: new Date('2026-02-10T00:00:00.000Z'),
        due_date_verified: true,
        status: 'pending',
      });
      expect(obligationModel.findFirst).toHaveBeenCalledWith({
        where: {
          organization_id: 1,
          accounting_entity_id: 77,
          type: 'withholding_return',
          period_start: new Date('2026-01-01T00:00:00.000Z'),
          period_end: new Date('2026-01-31T00:00:00.000Z'),
          jurisdiction_key: 'CO-DIAN',
        },
      });
    });

    it('uses the closing month and normalized fiscal range for bimonthly and four-month VAT', async () => {
      const { service } = makeCalendarService({ nit: '123456781' });
      const [bimonthly] = await service.generateForContext(context, {
        period_year: 2026,
        period_month: 2,
        periodicity: 'bimonthly',
        types: ['vat_return'],
      });
      const [fourMonthly] = await service.generateForContext(context, {
        period_year: 2026,
        period_month: 4,
        periodicity: 'four_monthly',
        types: ['vat_return'],
      });

      expect(bimonthly).toMatchObject({
        period_start: new Date('2026-01-01T00:00:00.000Z'),
        period_end: new Date('2026-02-28T00:00:00.000Z'),
        due_date: new Date('2026-03-10T00:00:00.000Z'),
        due_date_verified: true,
      });
      expect(fourMonthly).toMatchObject({
        period_start: new Date('2026-01-01T00:00:00.000Z'),
        period_end: new Date('2026-04-30T00:00:00.000Z'),
        due_date: new Date('2026-05-12T00:00:00.000Z'),
        due_date_verified: true,
      });
    });

    it('leaves unsupported year, missing NIT, SIMPLE, and legacy periodicity blocked without a fake deadline', async () => {
      const cases = [
        { options: { nit: '123456781' }, year: 2027, month: 2, periodicity: 'bimonthly' as const },
        { options: {}, year: 2026, month: 1, periodicity: 'monthly' as const },
        { options: { nit: '123456781', responsibilities: ['O-47'] }, year: 2026, month: 2, periodicity: 'bimonthly' as const },
        { options: { nit: '123456781' }, year: 2026, month: 2, periodicity: undefined },
      ];

      for (const testCase of cases) {
        const { service } = makeCalendarService(testCase.options);
        const [created] = await service.generateForContext(context, {
          period_year: testCase.year,
          period_month: testCase.month,
          periodicity: testCase.periodicity,
          types: ['vat_return'],
        });
        expect(created).toMatchObject({
          due_date: null,
          due_date_verified: false,
          status: 'blocked',
        });
        expect(created.blocking_reason).toContain('[CALENDAR_UNVERIFIED]');
      }
    });

    it('does not overwrite final obligations during force refresh', async () => {
      const final = {
        id: 32,
        organization_id: 1,
        accounting_entity_id: 77,
        status: 'paid',
        blocking_reason: null,
      };
      const { service, obligationModel } = makeCalendarService({
        nit: '123456781',
        existing: final,
      });
      const result = await service.generateForContext(context, {
        period_year: 2026,
        period_month: 1,
        periodicity: 'monthly',
        types: ['withholding_return'],
        force_refresh: true,
      });
      expect(result).toEqual([final]);
      expect(obligationModel.update).not.toHaveBeenCalled();
    });

    it('clears only a prior calendar block when a refresh finds a verified deadline', async () => {
      const priorCalendarBlock = {
        id: 33,
        organization_id: 1,
        accounting_entity_id: 77,
        status: 'blocked',
        blocking_reason: '[CALENDAR_UNVERIFIED] No configured deadline.',
      };
      const { service, obligationModel } = makeCalendarService({
        nit: '123456781',
        existing: priorCalendarBlock,
      });
      const [updated] = await service.generateForContext(context, {
        period_year: 2026,
        period_month: 1,
        periodicity: 'monthly',
        types: ['withholding_return'],
        force_refresh: true,
      });

      expect(obligationModel.update).toHaveBeenCalledWith({
        where: { id: 33 },
        data: expect.objectContaining({ status: 'pending', blocking_reason: null }),
      });
      expect(updated.due_date_verified).toBe(true);
    });

    it('preserves a non-calendar blocking reason during a verified refresh', async () => {
      const manualBlock = {
        id: 34,
        organization_id: 1,
        accounting_entity_id: 77,
        status: 'blocked',
        blocking_reason: 'Awaiting accountant review.',
      };
      const { service, obligationModel } = makeCalendarService({
        nit: '123456781',
        existing: manualBlock,
      });
      await service.generateForContext(context, {
        period_year: 2026,
        period_month: 1,
        periodicity: 'monthly',
        types: ['withholding_return'],
        force_refresh: true,
      });

      expect(obligationModel.update).toHaveBeenCalledWith({
        where: { id: 34 },
        data: expect.not.objectContaining({ status: 'pending', blocking_reason: null }),
      });
    });

    it('maps invalid periods to BadRequest before reading or writing obligations', async () => {
      const { service, obligationModel } = makeCalendarService({ nit: '123456781' });
      await expect(
        service.generateForContext(context, {
          period_year: 2026,
          period_month: 2,
          period_quarter: 1,
          periodicity: 'bimonthly',
          types: ['vat_return'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(obligationModel.findFirst).not.toHaveBeenCalled();
      expect(obligationModel.create).not.toHaveBeenCalled();
    });

    it('does not transition unverified obligations to overdue', async () => {
      const { service, obligationModel } = makeCalendarService();
      await service.refreshOverdue();
      expect(obligationModel.findMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['pending', 'in_progress', 'blocked', 'ready'] },
          due_date: { lt: expect.any(Date) },
          due_date_verified: true,
        },
        select: expect.any(Object),
      });
      expect(obligationModel.update).not.toHaveBeenCalled();
    });
  });
});
