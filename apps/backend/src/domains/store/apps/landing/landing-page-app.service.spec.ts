import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes } from '@common/errors/error-codes';
import { DomainConfigService } from '@common/config/domain.config';
import { AppDomainService } from '../shared/app-domain.service';
import { LandingPageAppService } from './landing-page-app.service';
import { parseLandingPageConfig } from './landing-page.reader';

/**
 * Apps · landing page (Fase 6). Runs the real `AppDomainService` over a small
 * in-memory `domain_settings` / `store_apps`, so publish → unpublish is
 * checked on the stored domains, not on mock calls.
 */
describe('LandingPageAppService', () => {
  const STORE_ID = 10;

  interface DomainRow {
    id: number;
    store_id: number;
    hostname: string;
    app_type: string;
    is_primary: boolean;
    ownership: string;
    status: string;
  }
  interface AppRow {
    id: number;
    store_id: number;
    kind: string;
    status: string;
    config: unknown;
    domain_settings_id: number | null;
  }

  let domains: DomainRow[];
  let apps: AppRow[];
  let landingContent: { enabled: boolean; published_json: unknown } | null;
  let sellable: number[];
  let events: { emit: jest.Mock };
  let cache: { del: jest.Mock };
  let service: LandingPageAppService;

  const row = (): AppRow | undefined => apps.find((a) => a.kind === 'landing');
  const domain = (id: number): DomainRow => domains.find((d) => d.id === id)!;

  const matches = (d: DomainRow, where: any): boolean =>
    (where.id === undefined || d.id === where.id) &&
    (where.store_id === undefined || d.store_id === where.store_id) &&
    (where.app_type === undefined ||
      (typeof where.app_type === 'string'
        ? d.app_type === where.app_type
        : where.app_type.in
          ? where.app_type.in.includes(d.app_type)
          : !where.app_type.notIn.includes(d.app_type))) &&
    (where.ownership === undefined ||
      (typeof where.ownership === 'string'
        ? d.ownership === where.ownership
        : where.ownership.in.includes(d.ownership))) &&
    (where.status === undefined || d.status !== where.status.not);

  const db = () => ({
    stores: {
      findUnique: jest.fn(async () => ({ slug: 'roku', organization_id: 1 })),
    },
    products: {
      count: jest.fn(async ({ where }: any) =>
        where.id.in.filter((id: number) => sellable.includes(id)).length,
      ),
    },
    crm_landing_pages: {
      findFirst: jest.fn(async () => landingContent),
    },
    domain_settings: {
      findMany: jest.fn(async ({ where }: any) =>
        domains.filter((d) => matches(d, where)),
      ),
      findFirst: jest.fn(
        async ({ where }: any) => domains.find((d) => matches(d, where)) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const created = { id: domains.length + 1, ...data };
        domains.push(created);
        return created;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const found = domain(where.id);
        Object.assign(found, data);
        return found;
      }),
    },
    store_apps: {
      findFirst: jest.fn(async ({ where }: any) => {
        const found = apps.find(
          (a) => a.store_id === where.store_id && a.kind === where.kind,
        );
        if (!found) return null;
        const d = domains.find((x) => x.id === found.domain_settings_id);
        return {
          id: found.id,
          status: found.status,
          config: found.config,
          domain_settings: d
            ? { id: d.id, hostname: d.hostname, ownership: d.ownership }
            : null,
        };
      }),
      create: jest.fn(async ({ data }: any) => {
        const created = { id: apps.length + 1, domain_settings_id: null, ...data };
        apps.push(created);
        return created;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const found = apps.find((a) => a.id === where.id)!;
        Object.assign(found, data);
        return found;
      }),
    },
  });

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);
    jest.spyOn(DomainConfigService, 'getBaseDomain').mockReturnValue('vendix.online');
    domains = [
      {
        id: 1,
        store_id: STORE_ID,
        hostname: 'roku-store.vendix.online',
        app_type: 'STORE_LANDING',
        is_primary: true,
        ownership: 'vendix_subdomain',
        status: 'active',
      },
      {
        id: 2,
        store_id: STORE_ID,
        hostname: 'promo.roku.co',
        app_type: 'STORE_ECOMMERCE',
        is_primary: false,
        ownership: 'custom_domain',
        status: 'active',
      },
      {
        id: 3,
        store_id: STORE_ID,
        hostname: 'oferta.roku.co',
        app_type: 'STORE_HOME',
        is_primary: false,
        ownership: 'custom_domain',
        status: 'active',
      },
    ];
    apps = [];
    landingContent = { enabled: true, published_json: { blocks: [] } };
    sellable = [7];
    events = { emit: jest.fn() };
    cache = { del: jest.fn().mockResolvedValue(undefined) };
    const prisma = db();
    const globalPrisma = { domain_settings: { findMany: prisma.domain_settings.findMany } };
    const appDomains = new AppDomainService(
      prisma as any,
      globalPrisma as any,
      events as any,
      cache as any,
    );
    service = new LandingPageAppService(prisma as any, appDomains);
  });

  afterEach(() => jest.restoreAllMocks());

  it('publishing creates {tienda}-landing as STORE_LANDING and leaves {tienda}-store untouched', async () => {
    await service.publish({});

    const created = domains.find((d) => d.hostname === 'roku-landing.vendix.online');
    expect(created).toMatchObject({
      app_type: 'STORE_LANDING',
      domain_type: 'store',
      is_primary: false,
      ownership: 'vendix_subdomain',
      status: 'active',
    });
    expect(row()).toMatchObject({ status: 'published', domain_settings_id: created!.id });
    expect(domain(1)).toMatchObject({ app_type: 'STORE_LANDING', status: 'active' });
    expect(cache.del).toHaveBeenCalledWith('seo:sitemap:roku-landing.vendix.online');
  });

  it('publishing without published content in Landing de captación is refused', async () => {
    landingContent = { enabled: true, published_json: null };

    await expect(service.publish({})).rejects.toMatchObject({
      errorCode: ErrorCodes.STORE_APPS_011.code,
    });
    expect(domains).toHaveLength(3);
    expect(row()).toBeUndefined();
  });

  it('unpublishing disables the subdomain and republishing reuses the same hostname', async () => {
    await service.publish({});
    const id = row()!.domain_settings_id!;

    await service.unpublish();
    expect(domain(id).status).toBe('disabled');
    expect(row()!.status).toBe('disabled');

    await service.publish({});
    expect(row()!.domain_settings_id).toBe(id);
    expect(domain(id).status).toBe('active');
    expect(domains.filter((d) => d.hostname.startsWith('roku-landing'))).toHaveLength(1);
  });

  it('a custom domain is taken over and gets its previous app back on unpublish', async () => {
    await service.publish({ custom_domain_id: 3 });

    expect(domain(3).app_type).toBe('STORE_LANDING');
    expect(
      parseLandingPageConfig(row()!.config).custom_domain_previous_app_type,
    ).toBe('STORE_HOME');

    await service.unpublish();
    expect(domain(3).app_type).toBe('STORE_HOME');
  });

  it('the online store custom domain cannot be taken', async () => {
    await expect(service.publish({ custom_domain_id: 2 })).rejects.toMatchObject({
      errorCode: ErrorCodes.STORE_APPS_005.code,
    });
    expect(domain(2).app_type).toBe('STORE_ECOMMERCE');
  });

  it('a backfilled published row without domain is left as it is on unpublish', async () => {
    apps.push({
      id: 1,
      store_id: STORE_ID,
      kind: 'landing',
      status: 'published',
      config: {},
      domain_settings_id: null,
    });

    await service.unpublish();

    expect(row()!.status).toBe('published');
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('saves an informative offer and drops any product id', async () => {
    await service.updateConfig({
      offer_mode: 'info',
      offer_title: '  Asesoría gratis  ',
      offer_description: 'Te llamamos hoy',
      offer_product_id: 7,
    });

    expect(row()!.status).toBe('draft');
    expect(parseLandingPageConfig(row()!.config)).toMatchObject({
      offer_mode: 'info',
      offer_title: 'Asesoría gratis',
      offer_description: 'Te llamamos hoy',
      offer_product_id: null,
    });
  });

  it('a product offer needs a product sold online', async () => {
    await expect(
      service.updateConfig({ offer_mode: 'product' }),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.STORE_APPS_012.code });
    await expect(
      service.updateConfig({ offer_mode: 'product', offer_product_id: 99 }),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.STORE_APPS_002.code });

    await service.updateConfig({ offer_mode: 'product', offer_product_id: 7 });
    expect(parseLandingPageConfig(row()!.config)).toMatchObject({
      offer_mode: 'product',
      offer_product_id: 7,
    });
  });
});
