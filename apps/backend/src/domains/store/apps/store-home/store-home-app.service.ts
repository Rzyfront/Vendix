import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import { AppDomainService } from '../shared/app-domain.service';
import { StoreHomeConfig, parseStoreHomeConfig } from './store-home.reader';
import { UpdateStoreHomeConfigDto } from './store-home.dto';

const APP_TYPE = 'STORE_HOME';
/** What the primary domain served before the store home, when unknown. */
const DEFAULT_PREVIOUS_APP_TYPE = 'STORE_LANDING';

/**
 * Apps · store home (plan S5, Fase 5): footer text, publish and unpublish of
 * the entry page of the store's primary `{tienda}-store` domain.
 *
 * No domain is created: publishing only switches that domain from
 * `STORE_LANDING` to `STORE_HOME` and keeps the previous `app_type` in
 * `store_apps.config`; unpublishing gives it back. A store that never
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
    // Fails before writing anything when the store has no primary domain.
    const domain = await this.domains.findStoreHomeDomain(storeId);

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

  /** Gives the primary domain back the app it served before. */
  async unpublish(): Promise<void> {
    const storeId = this.requireStoreId();
    const row = await this.findRow(storeId);
    if (!row || row.status !== 'published') return;

    const config = parseStoreHomeConfig(row.config);
    const domain = row.domain_settings;
    // Only undo our own switch: if someone pointed the domain elsewhere in
    // the meantime, that choice wins.
    if (domain && String(domain.app_type) === APP_TYPE) {
      await this.domains.setAppType(
        domain,
        config.domain_previous_app_type ?? DEFAULT_PREVIOUS_APP_TYPE,
      );
    }
    if (domain) await this.domains.clearSeoCache(domain.hostname);
    config.domain_previous_app_type = null;

    await this.prisma.store_apps.update({
      where: { id: row.id },
      data: {
        status: 'disabled',
        config: this.toJson(config),
        updated_at: new Date(),
      },
    });
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
          select: { id: true, hostname: true, app_type: true },
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
