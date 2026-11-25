import { Prisma } from '@prisma/client';
import {
  AppDomainAlias,
  parseAppDomainAliases,
} from '../shared/app-domain-aliases';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { sellableProductsWhere } from '../product-page/product-page.reader';
import {
  AppPageDocument,
  MAX_BLOCK_SERVICE_IDS,
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
  /**
   * Apps F5: the store's own domains that also serve this app, besides its
   * primary Vendix subdomain (`shared/app-domain-aliases.ts`).
   */
  custom_domain_aliases?: AppDomainAlias[];
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
    custom_domain_aliases: parseAppDomainAliases(raw),
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
 * Apps booking-detail — the services the owner picked by hand in the
 * `services` block (`selection: 'manual'`), in their order; `null` when the
 * block lists automatically (absent block, `auto` or no selection), so the
 * stored `service_ids` are never used outside manual mode. Reads the
 * validated page, so a page that no longer validates lists automatically.
 */
export function manualServiceIds(page: AppPageDocument | null): number[] | null {
  const props = page?.blocks.find((b) => b.type === 'services')?.props;
  if (!props || props['selection'] !== 'manual') return null;
  const ids = props['service_ids'];
  return Array.isArray(ids)
    ? ids
        .filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0)
        .slice(0, MAX_BLOCK_SERVICE_IDS)
    : [];
}

/**
 * The services the page lists. `services` must already be the store's online
 * services (read with `onlineServicesWhere(storeId)`), which is what scopes a
 * manual pick to the store: an id of another store, or one no longer sold
 * online, is simply not among them. Manual: the picked ones in the owner's
 * order (featured badge kept only on those); auto: `orderServices`.
 */
export function selectPageServices<T extends { id: number }>(
  services: T[],
  featuredIds: number[],
  manualIds: number[] | null,
): { services: T[]; featuredIds: number[] } {
  if (manualIds === null) return orderServices(services, featuredIds);
  const byId = new Map(services.map((s) => [s.id, s]));
  const picked = manualIds
    .map((id) => byId.get(id))
    .filter((s): s is T => !!s);
  const pickedIds = new Set(picked.map((s) => s.id));
  return {
    services: picked,
    featuredIds: featuredIds.filter((id) => pickedIds.has(id)),
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

  const page = readAppPage('service_page', app.config);
  const { services, featuredIds } = selectPageServices(
    allServices,
    config.featured_service_ids,
    manualServiceIds(page),
  );
  const productsById = new Map(productRows.map((p) => [p.id, p]));
  return {
    services,
    featured_service_ids: featuredIds,
    products: config.product_ids
      .map((id) => productsById.get(id))
      .filter((p): p is PublishedPageItem => !!p),
    page,
  };
}
