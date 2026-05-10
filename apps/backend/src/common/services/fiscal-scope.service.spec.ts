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
