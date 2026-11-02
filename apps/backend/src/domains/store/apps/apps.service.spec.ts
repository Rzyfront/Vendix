import { Test, TestingModule } from '@nestjs/testing';
import { AppsService } from './apps.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { APP_KINDS, AppKind } from './apps.catalog';

/**
 * Apps · Fase 0 (odd/tasks/apps-module.md, T5): read-only catalog.
 * The scoped Prisma client is mocked as an in-memory table that honours the
 * `where` the service sends, so a missing store filter would leak rows.
 */
describe('AppsService', () => {
  const STORE_ID = 10;
  const OTHER_STORE_ID = 99;

  interface Row {
    store_id: number;
    kind: AppKind;
    status: string;
    config: unknown;
    published_at: Date | null;
    domain_settings: { id: number; hostname: string; status: string } | null;
  }

  let service: AppsService;
  let rows: Row[];
  let industriesByStore: Record<number, string[]>;
  let prismaMock: {
    store_apps: { findMany: jest.Mock };
    stores: { findUnique: jest.Mock };
  };

  const ecommerceRow = (storeId: number): Row => ({
    store_id: storeId,
    kind: 'ecommerce',
    status: 'published',
    config: {},
    published_at: new Date('2026-10-01T00:00:00Z'),
    domain_settings: {
      id: 500 + storeId,
      hostname: `tienda${storeId}-shop.vendix.online`,
      status: 'active',
    },
  });

  beforeEach(async () => {
    rows = [];
    industriesByStore = {
      [STORE_ID]: ['retail'],
      [OTHER_STORE_ID]: ['retail'],
    };

    prismaMock = {
      store_apps: {
        findMany: jest.fn().mockImplementation(({ where, select }) =>
          Promise.resolve(
            rows
              .filter(
                (r) =>
                  (where?.store_id === undefined ||
                    r.store_id === where.store_id) &&
                  (where?.kind === undefined || r.kind === where.kind),
              )
              .map((r) => {
                const picked: Record<string, unknown> = {};
                for (const key of Object.keys(select)) {
                  picked[key] = r[key as keyof Row];
                }
                return picked;
              }),
          ),
        ),
      },
      stores: {
        findUnique: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              industriesByStore[where.id]
                ? { industries: industriesByStore[where.id] }
                : null,
            ),
          ),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppsService,
        { provide: StorePrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get(AppsService);
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);
  });

  afterEach(() => jest.restoreAllMocks());

  it('store without apps: lists the six apps as not_installed, no domain or URL', async () => {
    const result = await service.list();

    expect(result.map((app) => app.key)).toEqual([...APP_KINDS]);
    for (const app of result) {
      expect(app.status).toBe('not_installed');
      expect(app.domain).toBeNull();
      expect(app.public_url).toBeNull();
      expect(app.published_at).toBeNull();
    }
    expect(prismaMock.store_apps.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { store_id: STORE_ID } }),
    );
  });

  it('store with ecommerce: ecommerce is published with its domain and public URL; the rest stay not_installed', async () => {
    rows.push(ecommerceRow(STORE_ID));

    const result = await service.list();
    const ecommerce = result.find((app) => app.key === 'ecommerce')!;

    expect(ecommerce).toEqual({
      key: 'ecommerce',
      name: 'Tienda en línea',
      description: expect.any(String),
      applies_to_store_industries: true,
      status: 'published',
      domain: {
        id: 510,
        hostname: 'tienda10-shop.vendix.online',
        status: 'active',
      },
      public_url: 'https://tienda10-shop.vendix.online',
      published_at: new Date('2026-10-01T00:00:00Z'),
    });
    expect(
      result.filter((app) => app.key !== 'ecommerce').map((a) => a.status),
    ).toEqual(Array(5).fill('not_installed'));
  });

  it('published app on a domain that is not active yet: shows the domain but no public URL', async () => {
    const row = ecommerceRow(STORE_ID);
    row.domain_settings!.status = 'pending_ssl';
    rows.push(row);

    const ecommerce = (await service.list()).find(
      (a) => a.key === 'ecommerce',
    )!;

    expect(ecommerce.domain?.status).toBe('pending_ssl');
    expect(ecommerce.public_url).toBeNull();
  });

  it('industry applicability: booking applies only when one of the store industries is hospitality', async () => {
    industriesByStore[STORE_ID] = ['retail'];
    const retail = await service.list();
    expect(
      retail.find((a) => a.key === 'booking')!.applies_to_store_industries,
    ).toBe(false);
    expect(
      retail
        .filter((a) => a.key !== 'booking')
        .every((a) => a.applies_to_store_industries),
    ).toBe(true);

    industriesByStore[STORE_ID] = ['restaurant', 'hospitality'];
    const multi = await service.list();
    expect(multi.every((a) => a.applies_to_store_industries)).toBe(true);
  });

  it('does not leak rows from another store', async () => {
    rows.push(ecommerceRow(OTHER_STORE_ID), {
      store_id: OTHER_STORE_ID,
      kind: 'landing',
      status: 'published',
      config: { secret: true },
      published_at: new Date(),
      domain_settings: null,
    });

    const list = await service.list();
    expect(list.every((app) => app.status === 'not_installed')).toBe(true);
    expect(list.every((app) => app.domain === null)).toBe(true);

    const landing = await service.get('landing');
    expect(landing.status).toBe('not_installed');
    expect(landing.config).toEqual({});
    expect(prismaMock.store_apps.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { store_id: STORE_ID, kind: 'landing' },
      }),
    );
    expect(prismaMock.stores.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: STORE_ID } }),
    );
  });

  it('get(kind): returns the app detail with its own config', async () => {
    rows.push({
      store_id: STORE_ID,
      kind: 'product_page',
      status: 'draft',
      config: { featured_product_id: 7 },
      published_at: null,
      domain_settings: null,
    });

    const detail = await service.get('product_page');

    expect(detail).toMatchObject({
      key: 'product_page',
      status: 'draft',
      public_url: null,
      config: { featured_product_id: 7 },
    });
  });

  it('get(kind): unknown kind is rejected', async () => {
    await expect(service.get('menu' as AppKind)).rejects.toMatchObject({
      errorCode: 'STORE_APPS_001',
    });
  });

  it('without store context: forbidden, nothing is read', async () => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(undefined);

    await expect(service.list()).rejects.toBeInstanceOf(VendixHttpException);
    expect(prismaMock.store_apps.findMany).not.toHaveBeenCalled();
  });
});
