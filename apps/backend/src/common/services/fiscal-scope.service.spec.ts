import { BadRequestException } from '@nestjs/common';

import { FiscalScopeService } from './fiscal-scope.service';

describe('FiscalScopeService', () => {
  const createService = (client: any) => {
    const prisma = { withoutScope: () => client };
    return new FiscalScopeService(prisma as any);
  };

  it('resolves fiscal scope from organizations.fiscal_scope and caches it', async () => {
    const client = {
      organizations: {
        findUnique: jest.fn().mockResolvedValue({
          fiscal_scope: 'STORE',
          operating_scope: 'ORGANIZATION',
          account_type: 'MULTI_STORE_ORG',
        }),
      },
    };
    const service = createService(client);

    await expect(service.getFiscalScope(1)).resolves.toBe('STORE');
    await expect(service.getFiscalScope(1)).resolves.toBe('STORE');
    expect(client.organizations.findUnique).toHaveBeenCalledTimes(1);
  });

  it('rejects operating STORE with consolidated fiscal scope', () => {
    const service = createService({});

    expect(() =>
      service.assertValidScopeCombination('STORE', 'ORGANIZATION'),
    ).toThrow(BadRequestException);
  });

  it('resolves the only active store when fiscal scope is STORE and store_id is omitted', async () => {
    const client = {
      organizations: {
        findUnique: jest.fn().mockResolvedValue({
          fiscal_scope: 'STORE',
          operating_scope: 'STORE',
          account_type: 'SINGLE_STORE',
        }),
      },
      stores: {
        findMany: jest.fn().mockResolvedValue([{ id: 77 }]),
        findFirst: jest.fn(),
      },
      accounting_entities: {
        findFirst: jest.fn().mockResolvedValue({ id: 501, store_id: 77 }),
      },
    };
    const service = createService(client);

    await expect(
      service.resolveAccountingEntityForFiscal({ organization_id: 1 }),
    ).resolves.toEqual({ id: 501, store_id: 77 });
  });

  it('creates STORE fiscal entity from store-owned legal data', async () => {
    const client = {
      accounting_entities: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 501,
          store_id: 77,
          legal_name: 'Tienda Legal S.A.S.',
          tax_id: '901123456',
        }),
      },
      stores: {
        findFirst: jest.fn().mockResolvedValue({
          id: 77,
          name: 'Tienda Norte',
          legal_name: 'Tienda Legal S.A.S.',
          tax_id: '901123456',
        }),
      },
    };
    const service = createService(client);

    await expect(
      service.ensureStoreFiscalAccountingEntity(1, 77, client),
    ).resolves.toEqual(
      expect.objectContaining({
        legal_name: 'Tienda Legal S.A.S.',
        tax_id: '901123456',
      }),
    );

    expect(client.accounting_entities.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        legal_name: 'Tienda Legal S.A.S.',
        tax_id: '901123456',
      }),
    });
  });

  it('blocks STORE fiscal entity creation when the store has no tax_id', async () => {
    const client = {
      accounting_entities: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      stores: {
        findFirst: jest.fn().mockResolvedValue({
          id: 77,
          name: 'Tienda Norte',
          legal_name: 'Tienda Legal S.A.S.',
          tax_id: null,
        }),
      },
    };
    const service = createService(client);

    await expect(
      service.ensureStoreFiscalAccountingEntity(1, 77, client),
    ).rejects.toThrow(BadRequestException);
  });

  it('uses the consolidated entity when fiscal scope is ORGANIZATION even if a store_id is provided', async () => {
    const client = {
      organizations: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            fiscal_scope: 'ORGANIZATION',
            operating_scope: 'ORGANIZATION',
            account_type: 'MULTI_STORE_ORG',
          })
          .mockResolvedValueOnce({
            name: 'Org',
            legal_name: 'Org Legal S.A.S.',
            tax_id: '900123456',
          }),
      },
      accounting_entities: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 900,
          store_id: null,
          tax_id: '900123456',
        }),
      },
      stores: {
        findFirst: jest.fn(),
      },
    };
    const service = createService(client);

    await expect(
      service.resolveAccountingEntityForFiscal({
        organization_id: 1,
        store_id: 77,
      }),
    ).resolves.toEqual(expect.objectContaining({ id: 900, store_id: null }));
    expect(client.stores.findFirst).not.toHaveBeenCalled();
  });

  it('requires an explicit store when fiscal STORE scope has multiple active stores', async () => {
    const client = {
      organizations: {
        findUnique: jest.fn().mockResolvedValue({
          fiscal_scope: 'STORE',
          operating_scope: 'ORGANIZATION',
          account_type: 'MULTI_STORE_ORG',
        }),
      },
      stores: {
        findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      },
    };
    const service = createService(client);

    await expect(
      service.resolveAccountingEntityForFiscal({ organization_id: 1 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('marks cross-store transfers as intercompany only under STORE fiscal scope', async () => {
    const client = {
      organizations: {
        findUnique: jest.fn().mockResolvedValue({
          fiscal_scope: 'STORE',
          operating_scope: 'ORGANIZATION',
          account_type: 'MULTI_STORE_ORG',
        }),
      },
    };
    const service = createService(client);

    await expect(
      service.isIntercompanyTransfer({
        organization_id: 1,
        from_store_id: 10,
        to_store_id: 20,
      }),
    ).resolves.toBe(true);
    await expect(
      service.isIntercompanyTransfer({
        organization_id: 1,
        from_store_id: 10,
        to_store_id: 10,
      }),
    ).resolves.toBe(false);
  });
});
