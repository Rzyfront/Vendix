import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes } from '@common/errors/error-codes';
import { AppPageService } from './app-page.service';

/**
 * Apps F2 — saving an app's own page writes only `config.page`, over a small
 * in-memory `store_apps`, so the stored row is checked, not mock calls.
 */
describe('AppPageService', () => {
  const STORE_ID = 10;
  interface AppRow {
    id: number;
    store_id: number;
    kind: string;
    status: string;
    config: unknown;
    domain_settings: { hostname: string } | null;
  }

  let apps: AppRow[];
  let domains: { clearAppSeoCache: jest.Mock };
  let service: AppPageService;

  const page = {
    schema_version: 1,
    mode: 'sales',
    hero: { title: 'Mi producto' },
    blocks: [{ id: 'faq', type: 'faq', props: { title: 'Preguntas' } }],
  };

  beforeEach(() => {
    apps = [];
    const prisma = {
      store_apps: {
        findFirst: jest.fn(async ({ where }: any) =>
          apps.find((a) => a.store_id === where.store_id && a.kind === where.kind) ?? null,
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const row = apps.find((a) => a.id === where.id)!;
          row.config = data.config;
          return row;
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: apps.length + 1, domain_settings: null, ...data };
          apps.push(row);
          return row;
        }),
      },
    };
    domains = { clearAppSeoCache: jest.fn(async () => undefined) };
    service = new AppPageService(prisma as any, domains as any);
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);
  });

  afterEach(() => jest.restoreAllMocks());

  it('creates the app in draft with only its page when the store never touched it', async () => {
    await service.save('product_page', page);
    expect(apps).toEqual([
      expect.objectContaining({
        store_id: STORE_ID,
        kind: 'product_page',
        status: 'draft',
        config: {
          page: {
            schema_version: 1,
            mode: 'sales',
            sales: { enabled: true },
            booking: { enabled: false },
            hero: { title: 'Mi producto' },
            blocks: [{ id: 'faq', type: 'faq', enabled: true, props: { title: 'Preguntas' } }],
          },
        },
      }),
    ]);
  });

  it('keeps the product, complements and domain bookkeeping of a published app', async () => {
    apps.push({
      id: 1,
      store_id: STORE_ID,
      kind: 'product_page',
      status: 'published',
      config: { product_id: 4, complement_product_ids: [5], custom_domain_previous_app_type: null },
      domain_settings: { hostname: 'crema.vendix.online' },
    });

    await service.save('product_page', page);

    expect(apps[0].status).toBe('published');
    expect(apps[0].config).toEqual(
      expect.objectContaining({
        product_id: 4,
        complement_product_ids: [5],
        custom_domain_previous_app_type: null,
        page: expect.objectContaining({ mode: 'sales' }),
      }),
    );
    // Apps F5: the primary host and its aliases (read from the stored config).
    expect(domains.clearAppSeoCache).toHaveBeenCalledWith(
      expect.any(Number),
      'crema.vendix.online',
      expect.objectContaining({ product_id: 4 }),
    );
  });

  it('rejects an invalid page and writes nothing', async () => {
    await expect(
      service.save('product_page', { schema_version: 1, blocks: [{ id: 'a', type: 'hero' }] }),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.SYS_VALIDATION_001.code });
    expect(apps).toEqual([]);
  });
});
