import { Test, TestingModule } from '@nestjs/testing';
import { AppsService } from './apps.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { APP_KINDS, AppKind } from './apps.catalog';

/**
 * Apps · Fase 0 (odd/tasks/apps-module.md, T5) catalog, and the F1 light
 * catalog, online store live state and on/off switch (apps-vistas-f1 S2/S3/S5).
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
  let ecommerceDomain: { id: number; hostname: string; status: string } | null;
  let storeSettings: Record<string, unknown> | null;
  let prismaMock: {
    store_apps: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    stores: { findUnique: jest.Mock };
    domain_settings: { findFirst: jest.Mock };
    store_settings: { findUnique: jest.Mock };
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
    ecommerceDomain = null;
    storeSettings = null;
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
        findFirst: jest.fn().mockImplementation(({ where }) => {
          const index = rows.findIndex(
            (r) => r.store_id === where.store_id && r.kind === where.kind,
          );
          return Promise.resolve(
            index === -1 ? null : { id: index, status: rows[index].status },
          );
        }),
        create: jest.fn().mockImplementation(({ data }) => {
          rows.push({
            store_id: data.store_id,
            kind: data.kind,
            status: data.status,
            config: data.config,
            published_at: null,
            domain_settings: null,
          });
          return Promise.resolve({});
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          rows[where.id] = { ...rows[where.id], status: data.status };
          return Promise.resolve({});
        }),
      },
      domain_settings: {
        findFirst: jest.fn().mockImplementation(() =>
          Promise.resolve(ecommerceDomain),
        ),
      },
      store_settings: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve(storeSettings ? { settings: storeSettings } : null),
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
      enabled: true,
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

    const error = await service.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect((error as VendixHttpException).errorCode).toBe('SYS_FORBIDDEN_001');
    expect(prismaMock.store_apps.findMany).not.toHaveBeenCalled();
  });

  // ------------------------------------------------ apps-vistas-f1 (S2/S3/S5)

  it('S2: the light catalog never selects config and runs a fixed number of queries', async () => {
    rows.push(ecommerceRow(STORE_ID), {
      store_id: STORE_ID,
      kind: 'product_page',
      status: 'draft',
      config: { product_id: 7 },
      published_at: null,
      domain_settings: null,
    });

    const list = await service.list();

    const select = prismaMock.store_apps.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('config');
    expect(list.every((app) => !('config' in app))).toBe(true);
    expect(prismaMock.store_apps.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.stores.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.domain_settings.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.store_settings.findUnique).toHaveBeenCalledTimes(1);
    expect(list.find((a) => a.key === 'product_page')!.enabled).toBe(true);
    expect(list.find((a) => a.key === 'landing')!.enabled).toBe(false);
  });

  it('S5: the online store card follows its active domain and the availability switch', async () => {
    ecommerceDomain = { id: 77, hostname: 'tienda10.vendix.online', status: 'active' };

    const open = (await service.list()).find((a) => a.key === 'ecommerce')!;
    expect(open).toMatchObject({
      status: 'published',
      enabled: true,
      domain: { id: 77, hostname: 'tienda10.vendix.online', status: 'active' },
      public_url: 'https://tienda10.vendix.online',
    });
    expect(prismaMock.domain_settings.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { store_id: STORE_ID, app_type: 'STORE_ECOMMERCE', status: 'active' },
      }),
    );

    storeSettings = { ecommerce: { general: { store_available: false } } };
    const closed = (await service.list()).find((a) => a.key === 'ecommerce')!;
    expect(closed).toMatchObject({ status: 'disabled', enabled: false, public_url: null });
    expect(closed.domain?.hostname).toBe('tienda10.vendix.online');
  });

  it('S5: without an active ecommerce domain the stored row still answers', async () => {
    rows.push(ecommerceRow(STORE_ID));
    const ecommerce = (await service.list()).find((a) => a.key === 'ecommerce')!;
    expect(ecommerce.status).toBe('published');
    expect(ecommerce.domain?.id).toBe(510);
  });

  it('activate: a not installed app is created as draft and comes back enabled', async () => {
    const detail = await service.activate('product_page');

    expect(prismaMock.store_apps.create).toHaveBeenCalledWith({
      data: { store_id: STORE_ID, kind: 'product_page', status: 'draft', config: {} },
    });
    expect(detail).toMatchObject({ key: 'product_page', status: 'draft', enabled: true });
  });

  it('activate: a disabled app goes back to draft; a published one is untouched', async () => {
    rows.push({
      store_id: STORE_ID,
      kind: 'service_page',
      status: 'disabled',
      config: {},
      published_at: null,
      domain_settings: null,
    });
    expect((await service.activate('service_page')).status).toBe('draft');

    rows.push({ ...rows[0], kind: 'landing', status: 'published' });
    prismaMock.store_apps.update.mockClear();
    expect((await service.activate('landing')).status).toBe('published');
    expect(prismaMock.store_apps.update).not.toHaveBeenCalled();
  });

  it('activate: an app outside the store industries is rejected', async () => {
    await expect(service.activate('booking')).rejects.toMatchObject({
      errorCode: 'STORE_APPS_015',
    });
    expect(prismaMock.store_apps.create).not.toHaveBeenCalled();
  });

  it('deactivate: draft goes to disabled; published asks to unpublish first', async () => {
    rows.push({
      store_id: STORE_ID,
      kind: 'store_home',
      status: 'draft',
      config: {},
      published_at: null,
      domain_settings: null,
    });
    expect(await service.deactivate('store_home')).toMatchObject({
      status: 'disabled',
      enabled: false,
    });

    rows.push({ ...rows[0], kind: 'landing', status: 'published' });
    await expect(service.deactivate('landing')).rejects.toMatchObject({
      errorCode: 'STORE_APPS_014',
    });
    expect(rows[1].status).toBe('published');
  });

  it('activate/deactivate never touch the online store', async () => {
    await expect(service.activate('ecommerce')).rejects.toMatchObject({
      errorCode: 'STORE_APPS_013',
    });
    await expect(service.deactivate('ecommerce')).rejects.toMatchObject({
      errorCode: 'STORE_APPS_013',
    });
    expect(prismaMock.store_apps.create).not.toHaveBeenCalled();
    expect(prismaMock.store_apps.update).not.toHaveBeenCalled();
  });
});
