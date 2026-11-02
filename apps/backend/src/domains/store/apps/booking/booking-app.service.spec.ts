import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes } from '@common/errors/error-codes';
import { BookingAppService } from './booking-app.service';

/**
 * Apps · booking (Fase 4): hospitality-only gate, room-type requirement and
 * the `{store}-booking` domain. Prisma and the shared domain lifecycle are
 * mocked; `AppDomainService` has its own spec.
 */
describe('BookingAppService', () => {
  const STORE_ID = 10;

  let prisma: {
    stores: { findUnique: jest.Mock };
    products: { count: jest.Mock };
    lodging_unit_types: { count: jest.Mock };
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
  let service: BookingAppService;

  const expectCode = async (promise: Promise<unknown>, code: string) => {
    await expect(promise).rejects.toMatchObject({ errorCode: code });
  };

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);
    prisma = {
      stores: { findUnique: jest.fn().mockResolvedValue({ industries: ['hospitality'] }) },
      products: { count: jest.fn().mockResolvedValue(2) },
      lodging_unit_types: { count: jest.fn().mockResolvedValue(3) },
      store_apps: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    domains = {
      findTakeableCustomDomain: jest.fn().mockResolvedValue({ id: 77 }),
      takeOverCustomDomain: jest.fn().mockResolvedValue({
        domain: { id: 77, hostname: 'reservas.hotel.com' },
        previousAppType: 'STORE_LANDING',
      }),
      activateVendixHostname: jest
        .fn()
        .mockResolvedValue({ id: 40, hostname: 'roku-booking.vendix.online' }),
      releaseDomain: jest.fn().mockResolvedValue(undefined),
      clearSeoCache: jest.fn().mockResolvedValue(undefined),
      listCustomDomains: jest.fn().mockResolvedValue([]),
    };
    service = new BookingAppService(prisma as any, domains as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('refuses to publish for a store without the hospitality industry', async () => {
    prisma.stores.findUnique.mockResolvedValue({ industries: ['retail', 'services'] });
    await expectCode(service.publish({}), ErrorCodes.STORE_APPS_008.code);
    expect(domains.activateVendixHostname).not.toHaveBeenCalled();
    expect(prisma.store_apps.create).not.toHaveBeenCalled();
    expect(prisma.store_apps.update).not.toHaveBeenCalled();
  });

  it('refuses to save the config for a store without the hospitality industry', async () => {
    prisma.stores.findUnique.mockResolvedValue({ industries: ['retail'] });
    await expectCode(service.updateConfig({ product_ids: [1] }), ErrorCodes.STORE_APPS_008.code);
    expect(prisma.store_apps.create).not.toHaveBeenCalled();
  });

  it('refuses to publish when the PMS has no active room type', async () => {
    prisma.lodging_unit_types.count.mockResolvedValue(0);
    await expectCode(service.publish({}), ErrorCodes.STORE_APPS_009.code);
    expect(prisma.lodging_unit_types.count).toHaveBeenCalledWith({
      where: { store_id: STORE_ID, is_active: true },
    });
    expect(domains.activateVendixHostname).not.toHaveBeenCalled();
  });

  it('first publish creates the row and activates {store}-booking', async () => {
    prisma.store_apps.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 5, status: 'draft', config: {}, domain_settings: null });

    await service.publish({});

    expect(prisma.store_apps.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ store_id: STORE_ID, kind: 'booking', status: 'draft' }),
    });
    const [storeId, appType, build] = domains.activateVendixHostname.mock.calls[0];
    expect(storeId).toBe(STORE_ID);
    expect(appType).toBe('STORE_BOOKING');
    expect(build('Roku', 'vendix.online', () => false)).toBe('roku-booking.vendix.online');
    expect(prisma.store_apps.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ status: 'published', domain_settings_id: 40 }),
    });
    expect(domains.clearSeoCache).toHaveBeenCalledWith('roku-booking.vendix.online');
  });

  it('publishing on a custom domain keeps its previous app_type for the release', async () => {
    prisma.store_apps.findFirst.mockResolvedValue({
      id: 5,
      status: 'draft',
      config: { product_ids: [3] },
      domain_settings: null,
    });

    await service.publish({ custom_domain_id: 77 });

    expect(domains.takeOverCustomDomain).toHaveBeenCalledWith(STORE_ID, 77, 'STORE_BOOKING');
    expect(prisma.store_apps.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({
        status: 'published',
        domain_settings_id: 77,
        config: { product_ids: [3], custom_domain_previous_app_type: 'STORE_LANDING' },
      }),
    });
  });

  it('rejects an amenity that is not sold online', async () => {
    prisma.products.count.mockResolvedValue(1);
    await expectCode(service.updateConfig({ product_ids: [1, 2] }), ErrorCodes.STORE_APPS_002.code);
    expect(prisma.products.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        store_id: STORE_ID,
        id: { in: [1, 2] },
        product_type: { not: 'service' },
      }),
    });
    expect(prisma.store_apps.create).not.toHaveBeenCalled();
  });

  it('saves the amenities as a draft the first time', async () => {
    await service.updateConfig({ product_ids: [4, 4, 9] });
    expect(prisma.store_apps.create).toHaveBeenCalledWith({
      data: {
        store_id: STORE_ID,
        kind: 'booking',
        status: 'draft',
        config: { product_ids: [4, 9], custom_domain_previous_app_type: null },
      },
    });
  });

  it('unpublish releases the domain even if the store left hospitality', async () => {
    prisma.stores.findUnique.mockResolvedValue({ industries: ['retail'] });
    const domain = { id: 40, hostname: 'roku-booking.vendix.online', ownership: 'vendix_subdomain' };
    prisma.store_apps.findFirst.mockResolvedValue({
      id: 5,
      status: 'published',
      config: {},
      domain_settings: domain,
    });

    await service.unpublish();

    expect(domains.releaseDomain).toHaveBeenCalledWith(domain, null);
    expect(prisma.store_apps.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ status: 'disabled' }),
    });
  });
});
