import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import {
  AppCustomDomainView,
  AppDomainService,
} from '../shared/app-domain.service';
import { buildAppSuffixHostname } from '../product-page/product-page-hostname';
import { secondaryProductsWhere } from '../service-page/service-page.reader';
import {
  BOOKING_INDUSTRY,
  BookingPageConfig,
  parseBookingPageConfig,
} from './booking-page.reader';
import { PublishBookingPageDto, UpdateBookingPageConfigDto } from './booking-page.dto';

const APP_TYPE = 'STORE_BOOKING';
/** Plan S5: `{tienda}-booking.vendix.online`. */
const APP_SUFFIX = 'booking';

/**
 * Apps · booking (plan S5, Fase 4): config, publish and unpublish of the
 * hotel booking page.
 *
 * Only for stores with the `hospitality` industry (catalog entry `booking`);
 * every write checks it, so the API cannot bypass the card. Rooms, rates and
 * availability stay in the PMS: this service only owns the page's domain and
 * its secondary products.
 *
 * Tenant isolation: the store comes from the request context; every read
 * goes through `StorePrismaService` (auto-scoped) and filters by that store.
 * Domains follow S5 through `AppDomainService`, like the product and service
 * pages.
 */
@Injectable()
export class BookingAppService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly domains: AppDomainService,
  ) {}

  async updateConfig(dto: UpdateBookingPageConfigDto): Promise<void> {
    const storeId = this.requireStoreId();
    await this.assertHospitality(storeId);
    const products = [...new Set(dto.product_ids ?? [])];
    if (products.length > 0) {
      const found = await this.prisma.products.count({
        where: secondaryProductsWhere(storeId, products),
      });
      if (found !== products.length) {
        throw new VendixHttpException(ErrorCodes.STORE_APPS_002);
      }
    }

    const row = await this.findRow(storeId);
    const config: BookingPageConfig = {
      ...parseBookingPageConfig(row?.config),
      product_ids: products,
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
          kind: 'booking',
          status: 'draft',
          config: this.toJson(config),
        },
      });
    }

    if (row?.status === 'published' && row.domain_settings) {
      await this.domains.clearSeoCache(row.domain_settings.hostname);
    }
  }

  async publish(dto: PublishBookingPageDto): Promise<void> {
    const storeId = this.requireStoreId();
    await this.assertHospitality(storeId);
    const roomTypes = await this.prisma.lodging_unit_types.count({
      where: { store_id: storeId, is_active: true },
    });
    if (roomTypes === 0) {
      throw new VendixHttpException(ErrorCodes.STORE_APPS_009);
    }
    // Validate the target before releasing anything, so a rejected republish
    // leaves the current publication untouched.
    if (dto.custom_domain_id) {
      await this.domains.findTakeableCustomDomain(storeId, dto.custom_domain_id);
    }

    let row = await this.findRow(storeId);
    if (!row) {
      await this.prisma.store_apps.create({
        data: {
          store_id: storeId,
          kind: 'booking',
          status: 'draft',
          config: this.toJson(parseBookingPageConfig(null)),
        },
      });
      row = await this.findRow(storeId);
    }
    if (!row) throw new VendixHttpException(ErrorCodes.STORE_APPS_001);
    const config = parseBookingPageConfig(row.config);

    // Republishing on a different domain first releases the current one.
    if (row.status === 'published') {
      await this.domains.releaseDomain(
        row.domain_settings,
        config.custom_domain_previous_app_type,
      );
      config.custom_domain_previous_app_type = null;
    }

    let domain: { id: number; hostname: string };
    if (dto.custom_domain_id) {
      const taken = await this.domains.takeOverCustomDomain(
        storeId,
        dto.custom_domain_id,
        APP_TYPE,
      );
      domain = taken.domain;
      config.custom_domain_previous_app_type = taken.previousAppType;
    } else {
      domain = await this.domains.activateVendixHostname(
        storeId,
        APP_TYPE,
        (storeSlug, baseDomain, isTaken) =>
          buildAppSuffixHostname(storeSlug, APP_SUFFIX, baseDomain, isTaken),
      );
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

  /** Always allowed: a store that left hospitality can still take its page down. */
  async unpublish(): Promise<void> {
    const storeId = this.requireStoreId();
    const row = await this.findRow(storeId);
    if (!row || row.status !== 'published') return;

    const config = parseBookingPageConfig(row.config);
    await this.domains.releaseDomain(
      row.domain_settings,
      config.custom_domain_previous_app_type,
    );
    config.custom_domain_previous_app_type = null;

    await this.prisma.store_apps.update({
      where: { id: row.id },
      data: {
        status: 'disabled',
        config: this.toJson(config),
        updated_at: new Date(),
      },
    });
  }

  listCustomDomains(): Promise<AppCustomDomainView[]> {
    return this.domains.listCustomDomains(this.requireStoreId());
  }

  // ---------------------------------------------------------------------------

  private async assertHospitality(storeId: number): Promise<void> {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { industries: true },
    });
    const industries: string[] = store?.industries ?? [];
    if (!industries.includes(BOOKING_INDUSTRY)) {
      throw new VendixHttpException(ErrorCodes.STORE_APPS_008);
    }
  }

  private findRow(storeId: number) {
    return this.prisma.store_apps.findFirst({
      where: { store_id: storeId, kind: 'booking' },
      select: {
        id: true,
        status: true,
        config: true,
        domain_settings: {
          select: { id: true, hostname: true, ownership: true },
        },
      },
    });
  }

  private toJson(config: BookingPageConfig): Prisma.InputJsonValue {
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
