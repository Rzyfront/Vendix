import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import { AppDomainService } from './app-domain.service';
import {
  AppPageDocument,
  PageAppKind,
  validateAppPage,
} from './app-page.contract';

/**
 * Apps F2 — saves the app's own page (`store_apps.config.page`) for the
 * product page, service page, booking page and store home.
 *
 * Only `config.page` is written: the app's product, services, domain and
 * custom-domain bookkeeping stay as they are. Saving creates the app row in
 * `draft` when the store never touched the app, like the other config writes.
 * A published page gets its SEO cache cleared so the new title/description
 * reach the crawlers.
 *
 * Tenant isolation: the store comes from the request context and the write
 * goes through `StorePrismaService` (auto-scoped).
 */
@Injectable()
export class AppPageService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly domains: AppDomainService,
  ) {}

  async save(kind: PageAppKind, page: unknown): Promise<AppPageDocument> {
    const storeId = this.requireStoreId();
    const result = validateAppPage(kind, page);
    if (!result.valid || !result.value) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        result.errors.slice(0, 5).join(' '),
      );
    }
    const doc = result.value;

    const row = await this.prisma.store_apps.findFirst({
      where: { store_id: storeId, kind },
      select: {
        id: true,
        status: true,
        config: true,
        domain_settings: { select: { hostname: true } },
      },
    });

    if (row) {
      const current =
        row.config && typeof row.config === 'object' && !Array.isArray(row.config)
          ? (row.config as Record<string, unknown>)
          : {};
      await this.prisma.store_apps.update({
        where: { id: row.id },
        data: {
          config: { ...current, page: doc } as unknown as Prisma.InputJsonValue,
          updated_at: new Date(),
        },
      });
      if (row.status === 'published' && row.domain_settings) {
        await this.domains.clearAppSeoCache(
        storeId,
        row.domain_settings.hostname,
        row.config,
      );
      }
    } else {
      await this.prisma.store_apps.create({
        data: {
          store_id: storeId,
          kind,
          status: 'draft',
          config: { page: doc } as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return doc;
  }

  private requireStoreId(): number {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);
    }
    return storeId;
  }
}
