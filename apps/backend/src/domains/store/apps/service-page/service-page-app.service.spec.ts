import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes } from '@common/errors/error-codes';
import { ServicePageAppService } from './service-page-app.service';

/**
 * Apps · service page (Fase 3): publish rules. Prisma and the shared domain
 * lifecycle are mocked; the domain service has its own spec.
 */
describe('ServicePageAppService', () => {
  const STORE_ID = 10;

  let prisma: {
    products: { count: jest.Mock };
    store_apps: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  };
  let domains: {
    findTakeableCustomDomain: jest.Mock;
    takeOverCustomDomain: jest.Mock;
    activateVendixHostname: jest.Mock;
    releaseDomain: jest.Mock;
    clearSeoCache: jest.Mock;
    listCustomDomains: jest.Mock;
  };
  let service: ServicePageAppService;

  const publishedRow = (config: Record<string, unknown> = {}) => ({
    id: 5,
    status: 'published',
    config,
    domain_settings: { id: 40, hostname: 'roku-service.vendix.online', ownership: 'vendix_subdomain' },
  });

  const expectCode = async (promise: Promise<unknown>, code: string) => {
    await expect(promise).rejects.toMatchObject({ errorCode: code });
  };

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);
    prisma = {
      products: { count: jest.fn().mockResolvedValue(3) },
      store_apps: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    domains = {
      findTakeableCustomDomain: jest.fn().mockResolvedValue({ id: 77 }),
      takeOverCustomDomain: jest.fn().mockResolvedValue({
        domain: { id: 77, hostname: 'citas.spa.com' },
        previousAppType: 'STORE_LANDING',
      }),
      activateVendixHostname: jest
        .fn()
        .mockResolvedValue({ id: 40, hostname: 'roku-service.vendix.online' }),
      releaseDomain: jest.fn().mockResolvedValue(undefined),
      clearSeoCache: jest.fn().mockResolvedValue(undefined),
      listCustomDomains: jest.fn().mockResolvedValue([]),
    };
    service = new ServicePageAppService(prisma as any, domains as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('refuses to publish when the store has no online service', async () => {
    prisma.products.count.mockResolvedValue(0);
    await expectCode(service.publish({}), ErrorCodes.STORE_APPS_007.code);
    expect(prisma.products.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ store_id: STORE_ID, product_type: 'service' }),
    });
    expect(domains.activateVendixHostname).not.toHaveBeenCalled();
    expect(prisma.store_apps.update).not.toHaveBeenCalled();
  });

  it('first publish creates the row and activates {store}-service', async () => {
    prisma.store_apps.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 5, status: 'draft', config: {}, domain_settings: null });

    await service.publish({});

    expect(prisma.store_apps.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ store_id: STORE_ID, kind: 'service_page', status: 'draft' }),
    });
    const [storeId, appType, build] = domains.activateVendixHostname.mock.calls[0];
    expect(storeId).toBe(STORE_ID);
    expect(appType).toBe('STORE_SERVICE_PAGE');
    expect(build('Roku', 'vendix.online', () => false)).toBe('roku-service.vendix.online');
    expect(prisma.store_apps.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ status: 'published', domain_settings_id: 40 }),
    });
    expect(domains.clearSeoCache).toHaveBeenCalledWith('roku-service.vendix.online');
  });

  it('a rejected custom domain leaves the current publication untouched', async () => {
    prisma.store_apps.findFirst.mockResolvedValue(publishedRow());
    domains.findTakeableCustomDomain.mockRejectedValue(new Error('not takeable'));

    await expect(service.publish({ custom_domain_id: 999 })).rejects.toThrow('not takeable');
    expect(domains.releaseDomain).not.toHaveBeenCalled();
    expect(prisma.store_apps.update).not.toHaveBeenCalled();
  });

  it('publishing on a custom domain keeps its previous app type', async () => {
    prisma.store_apps.findFirst.mockResolvedValue(publishedRow());

    await service.publish({ custom_domain_id: 77 });

    expect(domains.releaseDomain).toHaveBeenCalledWith(publishedRow().domain_settings, null);
    expect(domains.takeOverCustomDomain).toHaveBeenCalledWith(STORE_ID, 77, 'STORE_SERVICE_PAGE');
    expect(prisma.store_apps.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({
        status: 'published',
        domain_settings_id: 77,
        config: expect.objectContaining({ custom_domain_previous_app_type: 'STORE_LANDING' }),
      }),
    });
  });

  it('unpublish gives the domain back and disables the app', async () => {
    prisma.store_apps.findFirst.mockResolvedValue(
      publishedRow({ custom_domain_previous_app_type: 'STORE_LANDING' }),
    );

    await service.unpublish();

    expect(domains.releaseDomain).toHaveBeenCalledWith(
      publishedRow().domain_settings,
      'STORE_LANDING',
    );
    expect(prisma.store_apps.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({
        status: 'disabled',
        config: expect.objectContaining({ custom_domain_previous_app_type: null }),
      }),
    });
  });

  it('rejects a featured id that is not an online service of the store', async () => {
    prisma.products.count.mockResolvedValueOnce(1);
    await expectCode(
      service.updateConfig({ featured_service_ids: [1, 2] }),
      ErrorCodes.STORE_APPS_006.code,
    );
    expect(prisma.products.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        store_id: STORE_ID,
        id: { in: [1, 2] },
        product_type: 'service',
      }),
    });
    expect(prisma.store_apps.create).not.toHaveBeenCalled();
  });

  it('saves featured services and secondary products without duplicates', async () => {
    prisma.products.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

    await service.updateConfig({ featured_service_ids: [2, 1, 2], product_ids: [9] });

    expect(prisma.store_apps.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        store_id: STORE_ID,
        kind: 'service_page',
        config: expect.objectContaining({ featured_service_ids: [2, 1], product_ids: [9] }),
      }),
    });
  });
});
