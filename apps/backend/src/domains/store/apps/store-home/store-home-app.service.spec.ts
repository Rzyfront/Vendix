import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes } from '@common/errors/error-codes';
import { AppDomainService } from '../shared/app-domain.service';
import { StoreHomeAppService } from './store-home-app.service';
import {
  DEFAULT_STORE_HOME_FOOTER,
  parseStoreHomeConfig,
  resolveStoreHomeBranding,
} from './store-home.reader';

/**
 * Apps · store home (Fase 5). Runs the real `AppDomainService` over a small
 * in-memory `domain_settings` / `store_apps`, so publish → unpublish is
 * checked on the stored `app_type` of the primary domain, not on mock calls.
 */
describe('StoreHomeAppService', () => {
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
    published_at?: Date;
  }

  let domains: DomainRow[];
  let apps: AppRow[];
  let events: { emit: jest.Mock };
  let cache: { del: jest.Mock };
  let service: StoreHomeAppService;

  const primary = (): DomainRow => domains.find((d) => d.id === 1)!;
  const row = (): AppRow | undefined => apps.find((a) => a.kind === 'store_home');

  const prisma = () => ({
    domain_settings: {
      findFirst: jest.fn(async ({ where }: any) => {
        const found = domains.find(
          (d) =>
            d.store_id === where.store_id &&
            d.is_primary === where.is_primary &&
            d.ownership === where.ownership &&
            where.app_type.in.includes(d.app_type) &&
            d.status !== where.status.not,
        );
        return found
          ? { id: found.id, hostname: found.hostname, app_type: found.app_type }
          : null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const found = domains.find((d) => d.id === where.id)!;
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
        const domain = domains.find((d) => d.id === found.domain_settings_id);
        return {
          id: found.id,
          status: found.status,
          config: found.config,
          domain_settings: domain
            ? { id: domain.id, hostname: domain.hostname, app_type: domain.app_type }
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
    ];
    apps = [];
    events = { emit: jest.fn() };
    cache = { del: jest.fn().mockResolvedValue(undefined) };
    const db = prisma();
    const appDomains = new AppDomainService(
      db as any,
      {} as any,
      events as any,
      cache as any,
    );
    service = new StoreHomeAppService(db as any, appDomains);
  });

  afterEach(() => jest.restoreAllMocks());

  it('a store that never publishes keeps its domain on STORE_LANDING', async () => {
    await service.updateConfig({ footer_text: 'Hecho con Vendix' });

    expect(primary().app_type).toBe('STORE_LANDING');
    expect(row()?.status).toBe('draft');
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('publishing switches the same hostname to STORE_HOME and keeps the previous type', async () => {
    await service.publish();

    expect(primary()).toMatchObject({
      hostname: 'roku-store.vendix.online',
      app_type: 'STORE_HOME',
      status: 'active',
    });
    expect(row()).toMatchObject({ status: 'published', domain_settings_id: 1 });
    expect(parseStoreHomeConfig(row()?.config).domain_previous_app_type).toBe(
      'STORE_LANDING',
    );
    expect(events.emit).toHaveBeenCalledWith('domain.updated', {
      domainId: 1,
      hostname: 'roku-store.vendix.online',
    });
    expect(cache.del).toHaveBeenCalledWith('seo:sitemap:roku-store.vendix.online');
  });

  it('rollback: publish → unpublish gives the domain back STORE_LANDING', async () => {
    await service.updateConfig({ footer_text: 'Hecho con Vendix' });
    await service.publish();
    await service.unpublish();

    expect(primary()).toMatchObject({
      hostname: 'roku-store.vendix.online',
      app_type: 'STORE_LANDING',
      status: 'active',
      is_primary: true,
    });
    expect(row()?.status).toBe('disabled');
    const config = parseStoreHomeConfig(row()?.config);
    expect(config.domain_previous_app_type).toBeNull();
    expect(config.footer_text).toBe('Hecho con Vendix');
  });

  it('republishing never records STORE_HOME as the type to go back to', async () => {
    await service.publish();
    await service.publish();
    await service.unpublish();

    expect(primary().app_type).toBe('STORE_LANDING');
  });

  it('unpublish does not override a domain someone already pointed elsewhere', async () => {
    await service.publish();
    primary().app_type = 'STORE_ECOMMERCE';
    await service.unpublish();

    expect(primary().app_type).toBe('STORE_ECOMMERCE');
    expect(row()?.status).toBe('disabled');
  });

  it('refuses to publish without an active primary {store}-store domain', async () => {
    primary().status = 'disabled';

    await expect(service.publish()).rejects.toMatchObject({
      errorCode: ErrorCodes.STORE_APPS_010.code,
    });
    expect(apps).toHaveLength(0);
  });

  it('unpublishing a store home that was never published changes nothing', async () => {
    await service.unpublish();

    expect(primary().app_type).toBe('STORE_LANDING');
    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('store home reader', () => {
  it('uses the store brand first, then the organization, field by field', () => {
    expect(
      resolveStoreHomeBranding(
        { name: 'Roku', logo_url: '', primary_color: '#111111' },
        { name: 'Org', logo_url: 'org/logo.png', primary_color: '#222222', accent_color: '#333333' },
      ),
    ).toEqual({
      name: 'Roku',
      logo_url: 'org/logo.png',
      primary_color: '#111111',
      secondary_color: null,
      accent_color: '#333333',
    });
  });

  it('leaves every field null when neither has a brand (Vendix default applies)', () => {
    expect(resolveStoreHomeBranding(null, undefined)).toEqual({
      name: null,
      logo_url: null,
      primary_color: null,
      secondary_color: null,
      accent_color: null,
    });
  });

  it('an empty footer falls back to the Vendix tagline', () => {
    expect(parseStoreHomeConfig({ footer_text: '   ' }).footer_text).toBeNull();
    expect(DEFAULT_STORE_HOME_FOOTER).toContain('Latinoamérica');
  });
});
