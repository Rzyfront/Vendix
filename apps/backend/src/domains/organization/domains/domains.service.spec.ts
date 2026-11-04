import { DomainsService } from './domains.service';

describe('Organization DomainsService', () => {
  it('creates organization subdomains as active when a wildcard parent exists', async () => {
    const parentDomain = {
      id: 11,
      hostname: 'example.com',
      ownership: 'custom_domain',
      status: 'active',
      ssl_status: 'issued',
      config: {
        ssl: {
          wildcard_hostname: '*.example.com',
          wildcard_status: 'issued',
        },
      },
      verification_token: null,
      last_verified_at: new Date('2026-01-01T00:00:00Z'),
      validation_cname_name: null,
      validation_cname_value: null,
    };
    const create = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        id: 12,
        ...data,
        verification_token: data.verification_token ?? null,
        validation_cname_name: null,
        validation_cname_value: null,
      }),
    );
    const prisma = {
      domain_settings: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([parentDomain]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create,
      },
    } as any;
    const service = new DomainsService(
      prisma,
      {} as any,
      { emit: jest.fn() } as any,
      { isBlocked: jest.fn().mockResolvedValue({ blocked: false }) } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await service.createDomainSetting({
      hostname: 'promo.example.com',
      organization_id: 1,
      app_type: 'ORG_LANDING' as any,
      ownership: 'custom_subdomain' as any,
      config: {},
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'active',
          ssl_status: 'issued',
          verification_token: null,
          config: expect.objectContaining({
            ssl: expect.objectContaining({
              inherited: true,
              inherited_from_hostname: 'example.com',
            }),
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'active',
        ssl_status: 'issued',
        ssl_inherited_from_hostname: 'example.com',
      }),
    );
  });

  it('Apps F5: accepts the app types of the apps as store app types and checks the app is published', async () => {
    const existing = {
      id: 77,
      hostname: 'reservas.hotel.com',
      store_id: 10,
      organization_id: 1,
      app_type: 'STORE_LANDING',
      domain_type: 'store',
      ownership: 'custom_domain',
      status: 'active',
    };
    const prisma = {
      domain_settings: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    } as any;
    const globalPrisma = {
      store_apps: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
    } as any;
    const service = new DomainsService(
      prisma,
      globalPrisma,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.updateDomainSetting('reservas.hotel.com', { app_type: 'STORE_SERVICE_PAGE' } as any),
    ).rejects.toMatchObject({
      errorCode: 'STORE_APPS_016',
      message: 'Publica primero la app «Página de servicios» para usar este dominio con ella.',
    });
    expect(globalPrisma.store_apps.findFirst).toHaveBeenCalledWith({
      where: { store_id: 10, kind: 'service_page', status: 'published' },
      select: { id: true },
    });
    expect(prisma.domain_settings.update).not.toHaveBeenCalled();
  });
});

