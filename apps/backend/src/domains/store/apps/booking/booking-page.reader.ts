import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import {
  AppDomainAlias,
  parseAppDomainAliases,
} from '../shared/app-domain-aliases';
import {
  PublishedPageItem,
  secondaryProductsWhere,
} from '../service-page/service-page.reader';
import {
  AppPageDocument,
  carryPage,
  readAppPage,
} from '../shared/app-page.contract';

/** Most products in the secondary amenities block. */
export const MAX_BOOKING_PRODUCTS = 8;

/** Industry that enables the booking app (catalog entry `booking`). */
export const BOOKING_INDUSTRY = 'hospitality';

/** Shape of `store_apps.config` for `kind = 'booking'`. */
export interface BookingPageConfig {
  /** Amenities and products shown below the booking, with the shared cart. */
  product_ids: number[];
  /**
   * When the page is published on one of the store's custom domains, the
   * `app_type` that domain had before, so unpublishing gives it back.
   */
  custom_domain_previous_app_type?: string | null;
  /** Apps F2: the app's own page (`app-page.contract.ts`), kept as stored. */
  page?: unknown;
  /**
   * Apps F5: the store's own domains that also serve this app, besides its
   * primary Vendix subdomain (`shared/app-domain-aliases.ts`).
   */
  custom_domain_aliases?: AppDomainAlias[];
}

/** Parses the stored JSON defensively. */
export function parseBookingPageConfig(raw: unknown): BookingPageConfig {
  const obj =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const previous = obj.custom_domain_previous_app_type;
  return {
    ...carryPage(raw),
    product_ids: Array.isArray(obj.product_ids)
      ? obj.product_ids.filter(
          (id): id is number => typeof id === 'number' && Number.isInteger(id),
        )
      : [],
    custom_domain_previous_app_type:
      typeof previous === 'string' ? previous : null,
    custom_domain_aliases: parseAppDomainAliases(raw),
  };
}

export interface PublishedBookingPage {
  /** Secondary products still sold online, in the owner's order. */
  products: PublishedPageItem[];
  /** Apps F2: the page the owner saved, or `null` (page as before F2). */
  page: AppPageDocument | null;
}

/**
 * The published booking page of a store. `null` when the store has no
 * published page or no active room type left to book. Rooms, rates,
 * availability and policies are not read here: the page asks the PMS booking
 * engine (`/ecommerce/hospitality/search`), unchanged. Tenant comes only
 * from `storeId`.
 */
export async function readPublishedBookingPage(
  prisma: GlobalPrismaService,
  storeId: number,
): Promise<PublishedBookingPage | null> {
  const app = await prisma.store_apps.findFirst({
    where: { store_id: storeId, kind: 'booking', status: 'published' },
    select: { config: true },
  });
  if (!app) return null;
  const config = parseBookingPageConfig(app.config);

  const [roomTypes, productRows] = await Promise.all([
    prisma.lodging_unit_types.count({
      where: { store_id: storeId, is_active: true },
    }),
    config.product_ids.length
      ? prisma.products.findMany({
          where: secondaryProductsWhere(storeId, config.product_ids),
          select: { id: true, slug: true, updated_at: true },
        })
      : Promise.resolve([] as PublishedPageItem[]),
  ]);
  if (roomTypes === 0) return null;

  const byId = new Map(productRows.map((p) => [p.id, p]));
  return {
    products: config.product_ids
      .map((id) => byId.get(id))
      .filter((p): p is PublishedPageItem => !!p),
    page: readAppPage('booking', app.config),
  };
}
