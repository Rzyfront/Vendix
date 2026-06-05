import { BadRequestException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { FiscalContextResolverService } from './fiscal-context-resolver.service';

describe('FiscalContextResolverService', () => {
  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: 10,
    is_super_admin: false,
    is_owner: true,
  };

  const createService = (overrides: any = {}) => {
    const prisma = {
      stores: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      ...overrides.prisma,
    };
    const fiscalScope = {
      requireFiscalScope: jest.fn().mockResolvedValue('ORGANIZATION'),
      resolveAccountingEntityForFiscal: jest.fn().mockResolvedValue({
        id: 77,
        store_id: null,
        tax_id: '900123456',
      }),
      ...overrides.fiscalScope,
    };
    const operatingScope = {
      requireOperatingScope: jest.fn().mockResolvedValue('ORGANIZATION'),
      ...overrides.operatingScope,
    };

    return {
      service: new FiscalContextResolverService(
        prisma as any,
        fiscalScope as any,
        operatingScope as any,
      ),
      prisma,
      fiscalScope,
      operatingScope,
    };
  };

  it('resolves consolidated organization fiscal context by accounting entity', async () => {
    const { service, fiscalScope } = createService();

    const result = await RequestContextService.run(requestContext, () =>
      service.resolveForOrganization({ store_id: 10 }),
    );

    expect(result).toMatchObject({
      organization_id: 1,
      store_id: null,
      fiscal_scope: 'ORGANIZATION',
      operating_scope: 'ORGANIZATION',
      accounting_entity_id: 77,
    });
    expect(fiscalScope.resolveAccountingEntityForFiscal).toHaveBeenCalledWith({
      organization_id: 1,
      store_id: null,
    });
  });

  it('requires store_id for mutating organization flows when fiscal_scope is STORE', async () => {
    const { service, fiscalScope } = createService({
      fiscalScope: {
        requireFiscalScope: jest.fn().mockResolvedValue('STORE'),
      },
    });

    await expect(
      RequestContextService.run(requestContext, () =>
        service.resolveForOrganization({ require_single_entity: true }),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(fiscalScope.resolveAccountingEntityForFiscal).not.toHaveBeenCalled();
  });

  it('resolves one fiscal context per active store for federated organization reads', async () => {
    const { service, prisma, fiscalScope } = createService({
      prisma: {
        stores: {
          findMany: jest.fn().mockResolvedValue([{ id: 10 }, { id: 20 }]),
        },
      },
      fiscalScope: {
        requireFiscalScope: jest.fn().mockResolvedValue('STORE'),
        resolveAccountingEntityForFiscal: jest
          .fn()
          .mockImplementation(({ store_id }) =>
            Promise.resolve({
              id: store_id === 10 ? 1010 : 2020,
              store_id,
            }),
          ),
      },
    });

    const result = await RequestContextService.run(requestContext, () =>
      service.resolveManyForOrganization(),
    );

    expect(prisma.stores.findMany).toHaveBeenCalledWith({
      where: { organization_id: 1, is_active: true },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    expect(result).toEqual([
      expect.objectContaining({
        store_id: 10,
        accounting_entity_id: 1010,
      }),
      expect.objectContaining({
        store_id: 20,
        accounting_entity_id: 2020,
      }),
    ]);
    expect(fiscalScope.resolveAccountingEntityForFiscal).toHaveBeenCalledTimes(
      2,
    );
  });
});
