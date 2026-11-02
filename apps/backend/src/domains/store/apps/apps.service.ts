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

interface StoreAppRow {
  kind: AppKind;
  status: AppStatus;
  config: unknown;
  published_at: Date | null;
  domain_settings: { id: number; hostname: string; status: string } | null;
}

/**
 * Apps — catálogo de aplicaciones web por tienda (Fase 0: solo lectura).
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
    const [industries, rows] = await Promise.all([
      this.getStoreIndustries(storeId),
      this.getRows(storeId),
    ]);
    const byKind = new Map(rows.map((row) => [row.kind, row]));

    return APP_CATALOG.map((entry) =>
      this.toView(entry, industries, byKind.get(entry.key) ?? null),
    );
  }

  async get(kind: AppKind): Promise<StoreAppDetailView> {
    const storeId = this.requireStoreId();
    const entry = APP_CATALOG.find((app) => app.key === kind);
    if (!entry) {
      throw new VendixHttpException(ErrorCodes.STORE_APPS_001);
    }

    const [industries, rows] = await Promise.all([
      this.getStoreIndustries(storeId),
      this.getRows(storeId, kind),
    ]);
    const row = rows[0] ?? null;

    return {
      ...this.toView(entry, industries, row),
      config: this.toConfig(row?.config),
    };
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

  private appliesTo(entry: AppCatalogEntry, industries: string[]): boolean {
    if (entry.industries === null) return true;
    return industries.some((industry) => entry.industries!.includes(industry));
  }

  private toConfig(config: unknown): Record<string, unknown> {
    return config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  }

  private async getRows(
    storeId: number,
    kind?: AppKind,
  ): Promise<StoreAppRow[]> {
    return this.prisma.store_apps.findMany({
      where: { store_id: storeId, ...(kind && { kind }) },
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
