import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { sellableProductsWhere } from '../product-page/product-page.reader';
import {
  AppPageDocument,
  carryPage,
  readAppPage,
} from '../shared/app-page.contract';

/** Most services the owner can feature at the top of the page. */
export const MAX_FEATURED_SERVICES = 12;
/** Most products in the secondary "también puedes comprar" block. */
export const MAX_SECONDARY_PRODUCTS = 8;
/**
 * Most services the public page lists. The page loads them through the
 * ecommerce catalog in one request, whose `limit` caps at 100.
 */
export const MAX_LISTED_SERVICES = 60;

/** Shape of `store_apps.config` for `kind = 'service_page'`. */
export interface ServicePageConfig {
  featured_service_ids: number[];
  product_ids: number[];
  /**
   * When the page is published on one of the store's custom domains, the
   * `app_type` that domain had before, so unpublishing gives it back.
   */
  custom_domain_previous_app_type?: string | null;
  /** Apps F2: the app's own page (`app-page.contract.ts`), kept as stored. */
  page?: unknown;
}

/**
 * A service the page may list: the product page's "sold online" rule
 * (active, available for ecommerce, for sale, not a hotel night) restricted
 * to `product_type = 'service'`. Booking itself is the ecommerce flow
 * (`/book/:productId` → `availability` → hold → checkout), unchanged.
 * `ids` omitted = every such service of the store.
 */
export function onlineServicesWhere(
  storeId: number,
  ids?: number[],
): Prisma.productsWhereInput {
  const where: Prisma.productsWhereInput = {
    ...sellableProductsWhere(storeId, ids ?? []),
    product_type: 'service',
  };
  if (!ids) delete where.id;
  return where;
}

/** A product of the secondary block: sold online and not a service. */
export function secondaryProductsWhere(
  storeId: number,
  ids: number[],
): Prisma.productsWhereInput {
  return {
    ...sellableProductsWhere(storeId, ids),
    product_type: { not: 'service' },
  };
}

function intList(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter(
        (id): id is number => typeof id === 'number' && Number.isInteger(id),
      )
    : [];
}

/** Parses the stored JSON defensively. */
export function parseServicePageConfig(raw: unknown): ServicePageConfig {
  const obj =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const previous = obj.custom_domain_previous_app_type;
  return {
    ...carryPage(raw),
    featured_service_ids: intList(obj.featured_service_ids),
    product_ids: intList(obj.product_ids),
    custom_domain_previous_app_type:
      typeof previous === 'string' ? previous : null,
  };
}

export interface PublishedPageItem {
  id: number;
  slug: string;
  updated_at: Date | null;
}

export interface PublishedServicePage {
  /** Featured services first (owner's order), then the rest by name. */
  services: PublishedPageItem[];
  featured_service_ids: number[];
  products: PublishedPageItem[];
  /** Apps F2: the page the owner saved, or `null` (page as before F2). */
  page: AppPageDocument | null;
}

/**
 * Orders the store's online services for the page: the featured ones in the
 * owner's order (skipping any that stopped being sold online), then the rest
 * in the order given, capped at `MAX_LISTED_SERVICES`.
 */
export function orderServices<T extends { id: number }>(
  services: T[],
  featuredIds: number[],
): { services: T[]; featuredIds: number[] } {
  const byId = new Map(services.map((s) => [s.id, s]));
  const featured = featuredIds
    .map((id) => byId.get(id))
    .filter((s): s is T => !!s);
  const featuredSet = new Set(featured.map((s) => s.id));
  const rest = services.filter((s) => !featuredSet.has(s.id));
  return {
    services: [...featured, ...rest].slice(0, MAX_LISTED_SERVICES),
    featuredIds: featured.map((s) => s.id),
  };
}

/**
 * The published service page of a store, reduced to what is still sold
 * online. `null` when the store has no published page or no online service
 * left. Tenant comes only from `storeId`.
 */
export async function readPublishedServicePage(
  prisma: GlobalPrismaService,
  storeId: number,
): Promise<PublishedServicePage | null> {
  const app = await prisma.store_apps.findFirst({
    where: { store_id: storeId, kind: 'service_page', status: 'published' },
    select: { config: true },
  });
  if (!app) return null;
  const config = parseServicePageConfig(app.config);

  const select = { id: true, slug: true, updated_at: true } as const;
  const [allServices, productRows] = await Promise.all([
    prisma.products.findMany({
      where: onlineServicesWhere(storeId),
      select,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    config.product_ids.length
      ? prisma.products.findMany({
          where: secondaryProductsWhere(storeId, config.product_ids),
          select,
        })
      : Promise.resolve([] as PublishedPageItem[]),
  ]);
  if (allServices.length === 0) return null;

  const { services, featuredIds } = orderServices(
    allServices,
    config.featured_service_ids,
  );
  const productsById = new Map(productRows.map((p) => [p.id, p]));
  return {
    services,
    featured_service_ids: featuredIds,
    products: config.product_ids
      .map((id) => productsById.get(id))
      .filter((p): p is PublishedPageItem => !!p),
    page: readAppPage('service_page', app.config),
  };
}
