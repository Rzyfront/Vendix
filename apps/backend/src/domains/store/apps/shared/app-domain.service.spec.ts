import { DomainConfigService } from '@common/config/domain.config';
import { ErrorCodes } from '@common/errors/error-codes';
import { AppDomainService } from './app-domain.service';

/**
 * Domain lifecycle shared by the product page and the service page (S5).
 * Pins the behaviour the product page had before it was extracted.
 */
describe('AppDomainService', () => {
  const STORE_ID = 10;
  let prisma: {
    stores: { findUnique: jest.Mock };
    domain_settings: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let globalPrisma: { domain_settings: { findMany: jest.Mock } };
  let events: { emit: jest.Mock };
  let cache: { del: jest.Mock };
  let service: AppDomainService;

  beforeEach(() => {
    jest.spyOn(DomainConfigService, 'getBaseDomain').mockReturnValue('vendix.online');
    prisma = {
      stores: { findUnique: jest.fn().mockResolvedValue({ slug: 'roku', organization_id: 3 }) },
      domain_settings: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 50, hostname: data.hostname, organization_id: 3, store_id: STORE_ID }),
        ),
        update: jest.fn().mockImplementation(({ where, data }) =>
          Promise.resolve({ id: where.id, hostname: 'h', organization_id: 3, store_id: STORE_ID, ...data }),
        ),
      },
    };
    globalPrisma = { domain_settings: { findMany: jest.fn().mockResolvedValue([]) } };
    events = { emit: jest.fn() };
    cache = { del: jest.fn().mockResolvedValue(undefined) };
    service = new AppDomainService(prisma as any, globalPrisma as any, events as any, cache as any);
  });

  afterEach(() => jest.restoreAllMocks());

  const build = (slug: string, base: string, isTaken: (h: string) => boolean) => {
    const first = `${slug}-service.${base}`;
    return isTaken(first) ? `${slug}-service-2.${base}` : first;
  };

  it('creates an active Vendix subdomain as domain_type store', async () => {
    const domain = await service.activateVendixHostname(STORE_ID, 'STORE_SERVICE_PAGE', build);

    expect(domain.hostname).toBe('roku-service.vendix.online');
    expect(prisma.domain_settings.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          store_id: STORE_ID,
          app_type: 'STORE_SERVICE_PAGE',
          domain_type: 'store',
          ownership: 'vendix_subdomain',
          status: 'active',
        }),
      }),
    );
    expect(events.emit).toHaveBeenCalledWith('domain.activated', expect.anything());
  });

  it("reuses the store's own earlier subdomain instead of burning -2", async () => {
    globalPrisma.domain_settings.findMany.mockResolvedValue([
      { hostname: 'roku-service.vendix.online' },
    ]);
    prisma.domain_settings.findMany.mockResolvedValue([
      { id: 44, hostname: 'roku-service.vendix.online' },
    ]);

    const domain = await service.activateVendixHostname(STORE_ID, 'STORE_SERVICE_PAGE', build);

    expect(domain.id).toBe(44);
    expect(prisma.domain_settings.create).not.toHaveBeenCalled();
    expect(prisma.domain_settings.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 44 }, data: expect.objectContaining({ status: 'active' }) }),
    );
  });

  it("takes -2 when another store owns the hostname", async () => {
    globalPrisma.domain_settings.findMany.mockResolvedValue([
      { hostname: 'roku-service.vendix.online' },
    ]);
    const domain = await service.activateVendixHostname(STORE_ID, 'STORE_SERVICE_PAGE', build);
    expect(domain.hostname).toBe('roku-service-2.vendix.online');
  });

  it('never takes the online store or admin domain', async () => {
    prisma.domain_settings.findFirst.mockResolvedValue({
      id: 9, hostname: 'shop.roku.com', app_type: 'STORE_ECOMMERCE', status: 'active',
    });
    await expect(service.takeOverCustomDomain(STORE_ID, 9, 'STORE_SERVICE_PAGE')).rejects.toMatchObject({
      errorCode: ErrorCodes.STORE_APPS_005.code,
    });
    expect(prisma.domain_settings.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 9, store_id: STORE_ID }) }),
    );
    expect(prisma.domain_settings.update).not.toHaveBeenCalled();
  });

  it('takes a custom domain and returns its previous app type', async () => {
    prisma.domain_settings.findFirst.mockResolvedValue({
      id: 9, hostname: 'citas.roku.com', app_type: 'STORE_LANDING', status: 'active',
    });
    const result = await service.takeOverCustomDomain(STORE_ID, 9, 'STORE_SERVICE_PAGE');
    expect(result.previousAppType).toBe('STORE_LANDING');
    expect(prisma.domain_settings.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 9 }, data: expect.objectContaining({ app_type: 'STORE_SERVICE_PAGE' }) }),
    );
  });

  it('release disables a Vendix subdomain and clears its SEO cache', async () => {
    await service.releaseDomain({ id: 44, hostname: 'Roku-Service.vendix.online', ownership: 'vendix_subdomain' }, null);
    expect(prisma.domain_settings.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 44 }, data: expect.objectContaining({ status: 'disabled' }) }),
    );
    expect(events.emit).toHaveBeenCalledWith('domain.disabled', expect.anything());
    expect(cache.del).toHaveBeenCalledWith('seo:sitemap:roku-service.vendix.online');
    expect(cache.del).toHaveBeenCalledWith('seo:robots:roku-service.vendix.online');
  });

  it('release gives a custom domain its previous app type back', async () => {
    await service.releaseDomain({ id: 9, hostname: 'citas.roku.com', ownership: 'custom_domain' }, 'STORE_LANDING');
    expect(prisma.domain_settings.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 9 }, data: expect.objectContaining({ app_type: 'STORE_LANDING' }) }),
    );
    expect(events.emit).toHaveBeenCalledWith('domain.updated', expect.anything());
  });
});
