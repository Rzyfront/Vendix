import { DynamicCorsService } from './dynamic-cors.service';

describe('DynamicCorsService', () => {
  const createService = (rows: Array<{ hostname: string }> = []) => {
    const configService = {
      get: jest.fn((key: string) =>
        key === 'BASE_DOMAIN' ? 'vendix.online' : undefined,
      ),
    };
    const cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      domain_settings: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
    };

    return {
      service: new DynamicCorsService(
        configService as any,
        cache as any,
        prisma as any,
      ),
      cache,
      prisma,
    };
  };

  it('allows Vendix platform origins without database lookup', async () => {
    const { service, prisma } = createService();

    await expect(
      service.isAllowed('https://gorrero-licores-store.vendix.online'),
    ).resolves.toBe(true);
    expect(prisma.domain_settings.findMany).not.toHaveBeenCalled();
  });

  it('allows active custom domains from domain settings', async () => {
    const { service, prisma, cache } = createService([
      { hostname: 'gorrerolicor.online' },
    ]);

    await expect(
      service.isAllowed('https://gorrerolicor.online'),
    ).resolves.toBe(true);
    expect(prisma.domain_settings.findMany).toHaveBeenCalledWith({
      where: { status: 'active' },
      select: { hostname: true },
    });
    expect(cache.set).toHaveBeenCalledWith(
      'cors:allowed_origins',
      ['https://gorrerolicor.online', 'http://gorrerolicor.online'],
      60000,
    );
  });
});
