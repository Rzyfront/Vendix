import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import {
  APP_CATALOG,
  AppCatalogEntry,
  AppKind,
  AppStatus,
} from './apps.catalog';
import { StoreAppDetailView, StoreAppView } from './dto';

interface StoreAppDomainRow {
  id: number;
  hostname: string;
  status: string;
}

interface StoreAppRow {
  kind: AppKind;
  status: AppStatus;
  published_at: Date | null;
  domain_settings: StoreAppDomainRow | null;
}

interface StoreAppRowWithConfig extends StoreAppRow {
  config: unknown;
}

/**
 * Real state of the online store, read from the same sources the storefront
 * uses: its active `STORE_ECOMMERCE` domain and the availability switch
 * (`settings.ecommerce.general.store_available`, absent = available, like
 * `StoreAvailabilityGuard`). `null` when the store has no active domain.
 */
interface EcommerceLiveState {
  domain: StoreAppDomainRow;
  available: boolean;
}

/** Statuses that count as "encendida" (installed and not switched off). */
const ENABLED_STATUSES: readonly AppStatus[] = ['draft', 'published'];

/**
 * Apps — catálogo de aplicaciones web por tienda.
 *
 * - `list()` is the light catalog (apps-vistas-f1 S2): name, status,
 *   encendida, domain and public URL. It never selects `config`, and it runs a
 *   fixed number of queries whatever the number of apps (no N+1).
 * - `get(kind)` is the detail the app view needs, config included.
 * - `activate`/`deactivate` switch an app on (`draft`) or off (`disabled`).
 *
 * The online store is never written here: its card derives its status from
 * the storefront's own sources, so `/admin/ecommerce` stays the only place
 * that changes it (S5).
 *
 * Tenant isolation: the store always comes from the request context, never
 * from a client parameter; `store_apps` is also auto-scoped by
 * `StorePrismaService`. A missing row means `not_installed`.
 */
@Injectable()
export class AppsService {
  constructor(private readonly prisma: StorePrismaService) {}

  async list(): Promise<StoreAppView[]> {
    const storeId = this.requireStoreId();
    const [industries, rows, ecommerce] = await Promise.all([
      this.getStoreIndustries(storeId),
      this.getRows(storeId),
      this.getEcommerceLiveState(storeId),
    ]);
    const byKind = new Map(rows.map((row) => [row.kind, row]));

    return APP_CATALOG.map((entry) =>
      this.toView(
        entry,
        industries,
        this.withLiveState(entry.key, byKind.get(entry.key) ?? null, ecommerce),
      ),
    );
  }

  async get(kind: AppKind): Promise<StoreAppDetailView> {
    const storeId = this.requireStoreId();
    const entry = this.requireEntry(kind);

    const [industries, row, ecommerce] = await Promise.all([
      this.getStoreIndustries(storeId),
      this.getRowWithConfig(storeId, kind),
      kind === 'ecommerce'
        ? this.getEcommerceLiveState(storeId)
        : Promise.resolve(null),
    ]);

    return {
      ...this.toView(entry, industries, this.withLiveState(kind, row, ecommerce)),
      config: this.toConfig(row?.config),
    };
  }

  /**
   * Switches an app on: `not_installed`/`disabled` → `draft`. An app already
   * on (`draft`/`published`) is left as it is. Publishing stays a separate
   * step, owned by each app's own service.
   */
  async activate(kind: AppKind): Promise<StoreAppDetailView> {
    const storeId = this.requireStoreId();
    const entry = this.requireManageableEntry(kind);
    const industries = await this.getStoreIndustries(storeId);
    if (!this.appliesTo(entry, industries)) {
      throw new VendixHttpException(ErrorCodes.STORE_APPS_015);
    }

    const row = await this.prisma.store_apps.findFirst({
      where: { store_id: storeId, kind },
      select: { id: true, status: true },
    });
    if (!row) {
      await this.prisma.store_apps.create({
        data: { store_id: storeId, kind, status: 'draft', config: {} },
      });
    } else if (!ENABLED_STATUSES.includes(row.status as AppStatus)) {
      await this.prisma.store_apps.update({
        where: { id: row.id },
        data: { status: 'draft', updated_at: new Date() },
      });
    }
    return this.get(kind);
  }

  /**
   * Switches an app off: `draft` → `disabled`. A published app must be
   * unpublished first (its own service releases the domain); an app that is
   * already off, or was never installed, is left as it is.
   */
  async deactivate(kind: AppKind): Promise<StoreAppDetailView> {
    const storeId = this.requireStoreId();
    this.requireManageableEntry(kind);

    const row = await this.prisma.store_apps.findFirst({
      where: { store_id: storeId, kind },
      select: { id: true, status: true },
    });
    if (row?.status === 'published') {
      throw new VendixHttpException(ErrorCodes.STORE_APPS_014);
    }
    if (row?.status === 'draft') {
      await this.prisma.store_apps.update({
        where: { id: row.id },
        data: { status: 'disabled', updated_at: new Date() },
      });
    }
    return this.get(kind);
  }

  private toView(
    entry: AppCatalogEntry,
    industries: string[],
    row: StoreAppRow | null,
  ): StoreAppView {
    const status: AppStatus = row?.status ?? 'not_installed';
    const domain = row?.domain_settings ?? null;

    return {
      key: entry.key,
      name: entry.name,
      description: entry.description,
      applies_to_store_industries: this.appliesTo(entry, industries),
      status,
      enabled: ENABLED_STATUSES.includes(status),
      domain: domain
        ? { id: domain.id, hostname: domain.hostname, status: domain.status }
        : null,
      public_url:
        status === 'published' && domain?.status === 'active'
          ? `https://${domain.hostname}`
          : null,
      published_at: row?.published_at ?? null,
    };
  }

  /**
   * The online store's card follows the storefront (S5): with an active
   * `STORE_ECOMMERCE` domain it is published on it, or disabled when the
   * owner closed the store. Without an active domain the stored row (Fase 0
   * backfill) still answers.
   */
  private withLiveState<T extends StoreAppRow>(
    kind: AppKind,
    row: T | null,
    ecommerce: EcommerceLiveState | null,
  ): T | StoreAppRow | null {
    if (kind !== 'ecommerce' || !ecommerce) return row;
    return {
      ...(row ?? { kind, published_at: null }),
      status: ecommerce.available ? 'published' : 'disabled',
      domain_settings: ecommerce.domain,
    };
  }

  private appliesTo(entry: AppCatalogEntry, industries: string[]): boolean {
    if (entry.industries === null) return true;
    return industries.some((industry) => entry.industries!.includes(industry));
  }

  private toConfig(config: unknown): Record<string, unknown> {
    return config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  }

  private requireEntry(kind: AppKind): AppCatalogEntry {
    const entry = APP_CATALOG.find((app) => app.key === kind);
    if (!entry) {
      throw new VendixHttpException(ErrorCodes.STORE_APPS_001);
    }
    return entry;
  }

  /** The online store is switched in `/admin/ecommerce`, never here (S5). */
  private requireManageableEntry(kind: AppKind): AppCatalogEntry {
    const entry = this.requireEntry(kind);
    if (kind === 'ecommerce') {
      throw new VendixHttpException(ErrorCodes.STORE_APPS_013);
    }
    return entry;
  }

  /** Light catalog rows: never selects `config` (S2). */
  private async getRows(storeId: number): Promise<StoreAppRow[]> {
    return this.prisma.store_apps.findMany({
      where: { store_id: storeId },
      select: {
        kind: true,
        status: true,
        published_at: true,
        domain_settings: {
          select: { id: true, hostname: true, status: true },
        },
      },
    });
  }

  private async getRowWithConfig(
    storeId: number,
    kind: AppKind,
  ): Promise<StoreAppRowWithConfig | null> {
    const rows: StoreAppRowWithConfig[] =
      await this.prisma.store_apps.findMany({
        where: { store_id: storeId, kind },
        select: {
          kind: true,
          status: true,
          config: true,
          published_at: true,
          domain_settings: {
            select: { id: true, hostname: true, status: true },
          },
        },
      });
    return rows[0] ?? null;
  }

  /**
   * Same domain the Fase 0 backfill picked (active `STORE_ECOMMERCE`,
   * primary first, then lowest id) plus the availability switch.
   */
  private async getEcommerceLiveState(
    storeId: number,
  ): Promise<EcommerceLiveState | null> {
    const [domain, settingsRow] = await Promise.all([
      this.prisma.domain_settings.findFirst({
        where: {
          store_id: storeId,
          app_type: 'STORE_ECOMMERCE',
          status: 'active',
        },
        orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
        select: { id: true, hostname: true, status: true },
      }),
      this.prisma.store_settings.findUnique({
        where: { store_id: storeId },
        select: { settings: true },
      }),
    ]);
    if (!domain) return null;

    const settings = settingsRow?.settings as unknown as {
      ecommerce?: { general?: { store_available?: boolean } };
    } | null;
    return {
      domain: { id: domain.id, hostname: domain.hostname, status: domain.status },
      available: settings?.ecommerce?.general?.store_available !== false,
    };
  }

  private async getStoreIndustries(storeId: number): Promise<string[]> {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { industries: true },
    });
    return store?.industries ?? [];
  }

  private requireStoreId(): number {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);
    }
    return storeId;
  }
}
