import { StoreDomainsService } from './domains.service';
import { RequestContextService } from '@common/context/request-context.service';

describe('StoreDomainsService', () => {
  it('creates one-level custom subdomains as active when a wildcard parent exists', async () => {
    const parentDomain = {
      id: 1,
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
    const createdDomain = {
      id: 2,
      hostname: 'promo.example.com',
      store_id: 10,
      ownership: 'custom_subdomain',
      status: 'active',
      ssl_status: 'issued',
      config: {},
      verification_token: null,
      last_verified_at: new Date('2026-01-01T00:00:00Z'),
      validation_cname_name: null,
      validation_cname_value: null,
    };
    const create = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        ...createdDomain,
        ...data,
      }),
    );
    const prisma = {
      domain_settings: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([parentDomain]),
        create,
      },
    } as any;
    const globalPrisma = {
      domain_roots: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;
    const service = new StoreDomainsService(
      prisma,
      globalPrisma,
      { emit: jest.fn() } as any,
      { isBlocked: jest.fn().mockResolvedValue({ blocked: false }) } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await RequestContextService.run(
      {
        organization_id: 1,
        store_id: 10,
        is_super_admin: false,
        is_owner: true,
      },
      () => {
        return service.create({
          hostname: 'promo.example.com',
          app_type: 'STORE_ECOMMERCE',
          ownership: 'custom_subdomain',
          config: {},
        });
      },
    );

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
              wildcard_hostname: '*.example.com',
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
