import { BadRequestException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { OrgInvoicingService } from './invoicing.service';

describe('OrgInvoicingService', () => {
  const requestContext = {
    user_id: 9,
    organization_id: 1,
    is_super_admin: false,
    is_owner: true,
  };

  const createService = (overrides: any = {}) => {
    const orgPrisma = {
      invoices: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({
          _count: { id: 0 },
          _sum: {
            subtotal_amount: null,
            tax_amount: null,
            withholding_amount: null,
            total_amount: null,
          },
        }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      invoice_resolutions: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      stores: {
        findFirst: jest.fn().mockResolvedValue({ id: 5 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ...overrides.orgPrisma,
    };

    const fiscalScope = {
      requireFiscalScope: jest.fn().mockResolvedValue('ORGANIZATION'),
      findFiscalAccountingEntityId: jest.fn().mockResolvedValue(42),
      ...overrides.fiscalScope,
    };

    return {
      service: new OrgInvoicingService(orgPrisma as any, fiscalScope as any),
      orgPrisma,
      fiscalScope,
    };
  };

  const runInContext = <T>(fn: () => Promise<T>): Promise<T> =>
    RequestContextService.run(requestContext as any, fn);

  it('filters by the org-level accounting entity when fiscal_scope=ORGANIZATION and store_id is null', async () => {
    const { service, orgPrisma, fiscalScope } = createService();

    const result = await runInContext(() =>
      service.findAll({ page: 1, limit: 10 } as any),
    );

    expect(fiscalScope.findFiscalAccountingEntityId).toHaveBeenCalledWith({
      organization_id: 1,
    });
    expect(orgPrisma.invoices.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ accounting_entity_id: 42 }),
      }),
    );
    const where = orgPrisma.invoices.findMany.mock.calls[0][0].where;
    expect(where.store_id).toBeUndefined();
    expect(result.scope).toMatchObject({
      organization_id: 1,
      fiscal_scope: 'ORGANIZATION',
      store_id: null,
      accounting_entity_id: 42,
    });
  });

  it('keeps the entity filter composable with the search OR', async () => {
    const { service, orgPrisma } = createService();

    await runInContext(() =>
      service.findAll({ page: 1, limit: 10, search: 'FV-001' } as any),
    );

    const where = orgPrisma.invoices.findMany.mock.calls[0][0].where;
    expect(where.accounting_entity_id).toBe(42);
    expect(where.OR).toHaveLength(4);
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { invoice_number: { contains: 'FV-001', mode: 'insensitive' } },
      ]),
    );
  });

  it('rejects fiscal_scope=STORE without store_id (regression)', async () => {
    const { service, fiscalScope, orgPrisma } = createService({
      fiscalScope: {
        requireFiscalScope: jest.fn().mockResolvedValue('STORE'),
      },
    });

    await expect(
      runInContext(() => service.findAll({ page: 1, limit: 10 } as any)),
    ).rejects.toThrow(BadRequestException);
    expect(fiscalScope.findFiscalAccountingEntityId).not.toHaveBeenCalled();
    expect(orgPrisma.invoices.findMany).not.toHaveBeenCalled();
  });

  it('filters by store_id without the entity filter when a store is requested', async () => {
    const { service, orgPrisma, fiscalScope } = createService();

    const result = await runInContext(() =>
      service.findAll({ page: 1, limit: 10, store_id: 5 } as any),
    );

    expect(fiscalScope.findFiscalAccountingEntityId).not.toHaveBeenCalled();
    const where = orgPrisma.invoices.findMany.mock.calls[0][0].where;
    expect(where.store_id).toBe(5);
    expect(where.accounting_entity_id).toBeUndefined();
    expect(result.scope).toMatchObject({
      store_id: 5,
      accounting_entity_id: null,
    });
  });

  it('skips the entity filter when the org-level entity does not exist yet', async () => {
    const { service, orgPrisma } = createService({
      fiscalScope: {
        requireFiscalScope: jest.fn().mockResolvedValue('ORGANIZATION'),
        findFiscalAccountingEntityId: jest.fn().mockResolvedValue(null),
      },
    });

    const result = await runInContext(() =>
      service.findAll({ page: 1, limit: 10 } as any),
    );

    const where = orgPrisma.invoices.findMany.mock.calls[0][0].where;
    expect(where.accounting_entity_id).toBeUndefined();
    expect(result.scope).toMatchObject({
      store_id: null,
      accounting_entity_id: null,
    });
  });

  it('applies the entity filter to resolutions when store_id is null', async () => {
    const { service, orgPrisma } = createService();

    await runInContext(() => service.getResolutions());

    expect(orgPrisma.invoice_resolutions.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accounting_entity_id: 42 },
      }),
    );
  });

  describe('FiscalScopeService.findFiscalAccountingEntityId (read-only)', () => {
    const buildClient = (entity: { id: number } | null) => ({
      organizations: {
        findUnique: jest.fn().mockResolvedValue({
          fiscal_scope: 'ORGANIZATION',
          operating_scope: 'ORGANIZATION',
          account_type: 'MULTI_STORE_ORG',
        }),
      },
      accounting_entities: {
        findFirst: jest.fn().mockResolvedValue(entity),
        create: jest.fn(),
      },
      stores: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    });

    it('returns the org-level entity id without creating rows', async () => {
      const client = buildClient({ id: 42 });
      const fiscalScopeService = new FiscalScopeService({} as any);

      const id = await fiscalScopeService.findFiscalAccountingEntityId({
        organization_id: 1,
        tx: client,
      });

      expect(id).toBe(42);
      expect(client.accounting_entities.findFirst).toHaveBeenCalledWith({
        where: {
          organization_id: 1,
          store_id: null,
          scope: 'ORGANIZATION',
          fiscal_scope: 'ORGANIZATION',
        },
        select: { id: true },
      });
      expect(client.accounting_entities.create).not.toHaveBeenCalled();
    });

    it('returns null (and never creates) when the entity is missing', async () => {
      const client = buildClient(null);
      const fiscalScopeService = new FiscalScopeService({} as any);

      const id = await fiscalScopeService.findFiscalAccountingEntityId({
        organization_id: 1,
        tx: client,
      });

      expect(id).toBeNull();
      expect(client.accounting_entities.create).not.toHaveBeenCalled();
    });
  });
});
