import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { CrmPublicService } from './crm-public.service';

jest.mock('../../../../prisma/services/store-prisma.service', () => ({
  StorePrismaService: class {},
}));
jest.mock('../../../../prisma/services/global-prisma.service', () => ({
  GlobalPrismaService: class {},
}));
jest.mock('../../settings/settings.service', () => ({ SettingsService: class {} }));
jest.mock('../../customers/customers.service', () => ({ CustomersService: class {} }));
jest.mock('../../notifications/notifications.service', () => ({
  NotificationsService: class {},
}));
jest.mock('@common/services/s3.service', () => ({ S3Service: class {} }));
jest.mock('../../analytics/services/products-analytics.service', () => ({
  ProductsAnalyticsService: class {},
}));

/**
 * F6-A: a section the owner hid never reaches the public landing, and the
 * editor preview gets the same real products and ecommerce base the public
 * page shows.
 */
describe('CrmPublicService · F6-A', () => {
  const STORE_ID = 10;
  let published: Record<string, unknown>;
  let prisma: {
    crm_landing_pages: { findFirst: jest.Mock };
    products: { findMany: jest.Mock };
  };
  let globalPrisma: { domain_settings: { findFirst: jest.Mock } };
  let service: CrmPublicService;

  beforeEach(() => {
    published = {
      schema_version: 1,
      blocks: [
        { id: 'hero', type: 'hero', props: { title: 'Hola' } },
        { id: 'faq', type: 'faq', props: {}, hidden: true },
        { id: 'grid', type: 'products_grid', props: {}, hidden: false },
      ],
    };
    prisma = {
      crm_landing_pages: {
        findFirst: jest.fn(async () => ({ enabled: true, published_json: published })),
      },
      products: {
        findMany: jest
          .fn()
          // fallback sin ventas: ids recientes, luego el detalle
          .mockResolvedValueOnce([{ id: 7 }])
          .mockResolvedValueOnce([
            { id: 7, name: 'Combo', slug: 'combo', base_price: 12000, product_images: [] },
          ]),
      },
    };
    globalPrisma = {
      domain_settings: {
        findFirst: jest.fn(async () => ({ hostname: 'roku.vendix.online' })),
      },
    };
    service = new CrmPublicService(
      prisma as never,
      globalPrisma as never,
      { getSettings: jest.fn(async () => ({ publication: {} })) } as never,
      {} as never,
      {} as never,
      { signUrl: jest.fn(async (key: string) => `signed:${key}`) } as never,
      { getTopSellingProducts: jest.fn(async () => []) } as never,
    );
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);
  });

  afterEach(() => jest.restoreAllMocks());

  it('drops hidden sections from the public document and keeps the visible ones in order', async () => {
    const result = await service.getPublicLanding();

    expect(result.document?.blocks.map((b) => b.id)).toEqual(['hero', 'grid']);
    // the stored draft is not mutated
    expect((published.blocks as unknown[]).length).toBe(3);
  });

  it('a document without hidden flags is served as before', async () => {
    published.blocks = [{ id: 'hero', type: 'hero', props: {} }];

    const result = await service.getPublicLanding();

    expect(result.document?.blocks.map((b) => b.id)).toEqual(['hero']);
  });

  it('preview context returns the real products and the ecommerce base', async () => {
    const result = await service.getPreviewContext();

    expect(result).toEqual({
      products: [{ name: 'Combo', slug: 'combo', price: 12000, image_url: null }],
      ecommerce_base_url: 'https://roku.vendix.online',
    });
  });

  it('preview context without a store context is forbidden', async () => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(undefined);

    const error = await service.getPreviewContext().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect((error as VendixHttpException).errorCode).toBe('SYS_FORBIDDEN_001');
    expect(prisma.products.findMany).not.toHaveBeenCalled();
  });
});
