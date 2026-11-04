import { Injectable } from '@nestjs/common';
import { DomainConfigService } from '@common/config/domain.config';
import { S3Service } from '@common/services/s3.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { APP_CATALOG } from '../apps.catalog';
import {
  DEFAULT_STORE_HOME_FOOTER,
  StoreHomeAppLink,
  StoreHomeBranding,
  parseStoreHomeConfig,
  resolveStoreHomeBranding,
} from './store-home.reader';

/** What the store home paints besides its page: name, brand, footer and published apps. */
export interface StoreHomeViewData {
  store_name: string | null;
  branding: StoreHomeBranding;
  footer: { text: string; site_url: string };
  /** Every published app with an active domain, in catalog order (before the owner's choice). */
  apps: StoreHomeAppLink[];
}

/**
 * F6-B — the data of the store home shared by its public read
 * (`GET /ecommerce/store-home`) and the editor's preview
 * (`GET /store/apps/store-home/preview-context`), so the preview paints the
 * same brand, footer and app links the published page does.
 *
 * Tenant isolation: every query filters by the `storeId` the caller resolved
 * from the request context (domain for the public read, JWT for the editor).
 */
@Injectable()
export class StoreHomeViewService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly s3: S3Service,
  ) {}

  /** `withApps: false` skips reading the published apps (the public page only lists them when its block is on). */
  async read(storeId: number, rawConfig: unknown, withApps = true): Promise<StoreHomeViewData> {
    const store = await this.globalPrisma.stores.findUnique({
      where: { id: storeId },
      select: { name: true, organization_id: true },
    });
    const [storeSettings, orgSettings, apps] = await Promise.all([
      this.globalPrisma.store_settings.findUnique({
        where: { store_id: storeId },
        select: { settings: true },
      }),
      store?.organization_id
        ? this.globalPrisma.organization_settings.findUnique({
            where: { organization_id: store.organization_id },
            select: { settings: true },
          })
        : null,
      withApps ? this.publishedApps(storeId) : ([] as StoreHomeAppLink[]),
    ]);
    const branding = resolveStoreHomeBranding(
      (storeSettings?.settings as { branding?: Record<string, unknown> } | null)?.branding,
      (orgSettings?.settings as { branding?: Record<string, unknown> } | null)?.branding,
    );
    if (branding.logo_url) {
      branding.logo_url = (await this.s3.signUrl(branding.logo_url)) ?? null;
    }
    const config = parseStoreHomeConfig(rawConfig);
    return {
      store_name: store?.name ?? branding.name,
      branding,
      footer: {
        text: config.footer_text ?? DEFAULT_STORE_HOME_FOOTER,
        site_url: `https://${DomainConfigService.getBaseDomain()}`,
      },
      apps,
    };
  }

  /**
   * Public links of the store's published apps for the "Mis apps" block:
   * the online store when its domain is active and the store is open, then
   * every other published app with an active domain. Name and URL only.
   */
  async publishedApps(storeId: number): Promise<StoreHomeAppLink[]> {
    const [ecommerceDomain, settingsRow, rows] = await Promise.all([
      this.globalPrisma.domain_settings.findFirst({
        where: { store_id: storeId, app_type: 'STORE_ECOMMERCE', status: 'active' },
        orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
        select: { hostname: true },
      }),
      this.globalPrisma.store_settings.findUnique({
        where: { store_id: storeId },
        select: { settings: true },
      }),
      this.globalPrisma.store_apps.findMany({
        where: {
          store_id: storeId,
          status: 'published',
          kind: { notIn: ['store_home', 'ecommerce'] },
        },
        select: {
          kind: true,
          domain_settings: { select: { hostname: true, status: true } },
        },
      }),
    ]);
    const nameOf = (kind: string) =>
      APP_CATALOG.find((entry) => entry.key === kind)?.name ?? kind;
    const storeOpen =
      (settingsRow?.settings as { ecommerce?: { general?: { store_available?: boolean } } } | null)
        ?.ecommerce?.general?.store_available !== false;

    const apps: StoreHomeAppLink[] = [];
    if (ecommerceDomain && storeOpen) {
      apps.push({
        kind: 'ecommerce',
        name: nameOf('ecommerce'),
        url: `https://${ecommerceDomain.hostname}`,
      });
    }
    for (const kind of APP_CATALOG.map((entry) => entry.key)) {
      const app = rows.find((row) => row.kind === kind);
      if (app?.domain_settings?.status === 'active') {
        apps.push({ kind, name: nameOf(kind), url: `https://${app.domain_settings.hostname}` });
      }
    }
    return apps;
  }
}
