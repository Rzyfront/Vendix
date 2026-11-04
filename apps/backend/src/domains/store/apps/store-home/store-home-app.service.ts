import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import { AppDomainService } from '../shared/app-domain.service';
import { buildAppSuffixHostname } from '../product-page/product-page-hostname';
import { StoreHomeConfig, parseStoreHomeConfig } from './store-home.reader';
import { UpdateStoreHomeConfigDto } from './store-home.dto';

const APP_TYPE = 'STORE_HOME';
/** What the primary domain served before the store home, when unknown. */
const DEFAULT_PREVIOUS_APP_TYPE = 'STORE_LANDING';

interface StoreHomeDomainRow {
  id: number;
  hostname: string;
  app_type: unknown;
  ownership: string;
  is_primary: boolean;
  status: string;
}

/**
 * A subdomain the store home generated itself (Apps F5): a Vendix subdomain
 * that is not the store's primary domain.
 */
function isOwnSubdomain(domain: { ownership: string; is_primary: boolean }): boolean {
  return domain.ownership === 'vendix_subdomain' && !domain.is_primary;
}

function buildStoreHomeHostname(
  storeSlug: string,
  baseDomain: string,
  isTaken: (hostname: string) => boolean,
): string | null {
  return buildAppSuffixHostname(storeSlug, 'store', baseDomain, isTaken);
}

/**
 * Apps · store home (plan S5, Fase 5): footer text, publish and unpublish of
 * the entry page of the store's primary `{tienda}-store` domain.
 *
 * Publishing switches that domain from `STORE_LANDING` to `STORE_HOME`
 * and keeps the previous `app_type` in `store_apps.config`; unpublishing
 * gives it back. A store without that domain gets its own `{tienda}-store`
 * subdomain (Apps F5), disabled on unpublish and reactivated on republish. A store that never
 * publishes keeps exactly today's landing. The landing content
 * (`crm_landing_pages`, store settings) is never touched, so it is back as
 * it was after unpublishing.
 *
 * Tenant isolation: the store comes from the request context; every read
 * goes through `StorePrismaService` (auto-scoped) and filters by that store.
 */
@Injectable()
export class StoreHomeAppService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly domains: AppDomainService,
  ) {}

  async updateConfig(dto: UpdateStoreHomeConfigDto): Promise<void> {
    const storeId = this.requireStoreId();
    const row = await this.findRow(storeId);
    const config: StoreHomeConfig = {
      ...parseStoreHomeConfig(row?.config),
      footer_text: dto.footer_text?.trim() || null,
    };
    if (row) {
      await this.prisma.store_apps.update({
        where: { id: row.id },
        data: { config: this.toJson(config), updated_at: new Date() },
      });
    } else {
      await this.prisma.store_apps.create({
        data: {
          store_id: storeId,
          kind: 'store_home',
          status: 'draft',
          config: this.toJson(config),
        },
      });
    }
  }

  async publish(): Promise<void> {
    const storeId = this.requireStoreId();
    let row = await this.findRow(storeId);
    if (!row) {
      await this.prisma.store_apps.create({
        data: {
          store_id: storeId,
          kind: 'store_home',
          status: 'draft',
          config: this.toJson(parseStoreHomeConfig(null)),
        },
      });
      row = await this.findRow(storeId);
    }
    if (!row) throw new VendixHttpException(ErrorCodes.STORE_APPS_001);
    const config = parseStoreHomeConfig(row.config);
    const domain = await this.resolveDomain(storeId, row.domain_settings);

    // Republishing while the domain already serves the store home keeps the
    // app_type saved the first time, never `STORE_HOME` itself.
    if (domain.app_type !== APP_TYPE) {
      config.domain_previous_app_type = domain.app_type;
      await this.domains.setAppType(domain, APP_TYPE);
    } else if (!config.domain_previous_app_type) {
      config.domain_previous_app_type = DEFAULT_PREVIOUS_APP_TYPE;
    }

    await this.prisma.store_apps.update({
      where: { id: row.id },
      data: {
        status: 'published',
        published_at: new Date(),
        domain_settings_id: domain.id,
        config: this.toJson(config),
        updated_at: new Date(),
      },
    });
    await this.domains.clearSeoCache(domain.hostname);
  }

  /** Gives the domain back: the primary its app, our own subdomain disabled. */
  async unpublish(): Promise<void> {
    const storeId = this.requireStoreId();
    const row = await this.findRow(storeId);
    if (!row || row.status !== 'published') return;

    const config = parseStoreHomeConfig(row.config);
    const domain = row.domain_settings;
    // Only undo our own switch: if someone pointed the domain elsewhere in
    // the meantime, that choice wins.
    if (domain && String(domain.app_type) === APP_TYPE) {
      if (isOwnSubdomain(domain)) {
        // The subdomain the store home generated: disabled, never deleted,
        // so the next publish reactivates it.
        await this.domains.releaseDomain(domain, null);
      } else {
        await this.domains.setAppType(
          domain,
          config.domain_previous_app_type ?? DEFAULT_PREVIOUS_APP_TYPE,
        );
      }
    }
    if (domain) await this.domains.clearSeoCache(domain.hostname);
    config.domain_previous_app_type = null;
    // Apps F5: own domains pointed to the store home from the domains modal.
    for (const alias of config.custom_domain_aliases ?? []) {
      await this.domains.releaseAlias(storeId, APP_TYPE, alias);
    }
    config.custom_domain_aliases = [];

    await this.prisma.store_apps.update({
      where: { id: row.id },
      data: {
        status: 'disabled',
        config: this.toJson(config),
        updated_at: new Date(),
      },
    });
  }

  /**
   * The domain the store home publishes on (Apps F5, Rafael's rule):
   * 1. its own subdomain from an earlier publish, reactivated if disabled;
   * 2. the store's primary `{tienda}-store` domain, as before;
   * 3. otherwise a new, globally free `{tienda}-store` subdomain (`-2`, ...
   *    when taken), so publishing never fails for lack of a domain.
   */
  private async resolveDomain(
    storeId: number,
    current: StoreHomeDomainRow | null,
  ): Promise<{ id: number; hostname: string; app_type: string }> {
    if (current && isOwnSubdomain(current) && String(current.app_type) === APP_TYPE) {
      const own = await this.domains.activateVendixHostname(
        storeId,
        APP_TYPE,
        buildStoreHomeHostname,
        current,
      );
      return { ...own, app_type: APP_TYPE };
    }
    const primary = await this.domains.findStoreHomeDomain(storeId);
    if (primary) return primary;
    const created = await this.domains.activateVendixHostname(
      storeId,
      APP_TYPE,
      buildStoreHomeHostname,
    );
    return { ...created, app_type: APP_TYPE };
  }

  // ---------------------------------------------------------------------------

  private findRow(storeId: number) {
    return this.prisma.store_apps.findFirst({
      where: { store_id: storeId, kind: 'store_home' },
      select: {
        id: true,
        status: true,
        config: true,
        domain_settings: {
          select: {
            id: true,
            hostname: true,
            app_type: true,
            ownership: true,
            is_primary: true,
            status: true,
          },
        },
      },
    });
  }

  private toJson(config: StoreHomeConfig): Prisma.InputJsonValue {
    return config as unknown as Prisma.InputJsonValue;
  }

  private requireStoreId(): number {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);
    }
    return storeId;
  }
}
