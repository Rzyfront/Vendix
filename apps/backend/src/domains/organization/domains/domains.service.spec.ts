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
});
