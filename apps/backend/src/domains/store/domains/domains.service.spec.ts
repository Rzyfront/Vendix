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

  describe('Apps F5: app types of the apps in the domain modal', () => {
    const CTX = { organization_id: 1, store_id: 10, is_super_admin: false, is_owner: true };
    const existing = {
      id: 77,
      hostname: 'reservas.hotel.com',
      store_id: 10,
      organization_id: 1,
      app_type: 'STORE_LANDING',
      domain_type: 'store',
      ownership: 'custom_domain',
      status: 'active',
      is_primary: true,
      config: {},
    };
    let prisma: any;
    let globalPrisma: any;
    let service: StoreDomainsService;

    beforeEach(() => {
      prisma = {
        domain_settings: {
          findFirst: jest.fn().mockResolvedValue(existing),
          update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...existing, ...data })),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      globalPrisma = {
        store_apps: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn().mockResolvedValue({}),
        },
      };
      service = new StoreDomainsService(
        prisma,
        globalPrisma,
        { emit: jest.fn() } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
    });

    const update = (dto: Record<string, unknown>) =>
      RequestContextService.run(CTX, () => service.update(77, dto as any));

    it('refuses an app type whose app is not published, without writing', async () => {
      await expect(update({ app_type: 'STORE_BOOKING', is_primary: true })).rejects.toMatchObject({
        errorCode: 'STORE_APPS_016',
      });
      expect(prisma.domain_settings.update).not.toHaveBeenCalled();
      expect(prisma.domain_settings.updateMany).not.toHaveBeenCalled();
    });

    it('with the app published, the domain becomes an alias and the app subdomain stays active', async () => {
      globalPrisma.store_apps.findFirst
        .mockResolvedValueOnce({ id: 5 }) // published check
        .mockResolvedValueOnce({ id: 5, domain_settings_id: 40, config: {} }); // alias list

      const result = await update({ app_type: 'STORE_BOOKING', is_primary: true });

      expect(result.app_type).toBe('STORE_BOOKING');
      // No "single active domain per app type" sweep for an app.
      expect(prisma.domain_settings.updateMany).not.toHaveBeenCalled();
      expect(globalPrisma.store_apps.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: expect.objectContaining({
          config: {
            custom_domain_aliases: [{ domain_id: 77, previous_app_type: 'STORE_LANDING' }],
          },
        }),
      });
    });

    it('the existing app types keep sweeping the other active domains as before', async () => {
      await update({ app_type: 'STORE_LANDING', is_primary: true });
      expect(prisma.domain_settings.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ app_type: 'STORE_LANDING', status: 'active' }),
        }),
      );
      expect(globalPrisma.store_apps.findFirst).not.toHaveBeenCalled();
    });
  });
});

