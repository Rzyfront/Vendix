import { Prisma } from '@prisma/client';
import {
  AppDomainAlias,
  parseAppDomainAliases,
} from '../shared/app-domain-aliases';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import {
  AppPageDocument,
  carryPage,
  readAppPage,
} from '../shared/app-page.contract';

/** Most complements a page shows; keeps the block and the sitemap small. */
export const MAX_COMPLEMENTS = 8;

/** Shape of `store_apps.config` for `kind = 'product_page'`. */
export interface ProductPageConfig {
  product_id: number | null;
  complement_product_ids: number[];
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
 * A product the page may show: the same rule the ecommerce sitemap uses for
 * "sold online" (active, available for ecommerce, for sale, not a hotel
 * night). The admin validation, the public endpoint and the sitemap all use
 * this one filter, so the three cannot disagree about a product.
 */
export function sellableProductsWhere(
  storeId: number,
  ids: number[],
): Prisma.productsWhereInput {
  return {
    store_id: storeId,
    id: { in: ids },
    state: 'active',
    available_for_ecommerce: true,
    usage_nature: 'sale',
    lodging_unit_type: { is: null },
  };
}

/** Parses the stored JSON defensively; unknown keys are kept by callers. */
export function parseProductPageConfig(raw: unknown): ProductPageConfig {
  const obj =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const productId =
    typeof obj.product_id === 'number' && Number.isInteger(obj.product_id)
      ? obj.product_id
      : null;
  const complements = Array.isArray(obj.complement_product_ids)
    ? obj.complement_product_ids.filter(
        (id): id is number => typeof id === 'number' && Number.isInteger(id),
      )
    : [];
  const previous = obj.custom_domain_previous_app_type;
  return {
    ...carryPage(raw),
    product_id: productId,
    complement_product_ids: complements,
    custom_domain_previous_app_type:
      typeof previous === 'string' ? previous : null,
    custom_domain_aliases: parseAppDomainAliases(raw),
  };
}

export interface PublishedProductPage {
  product: { id: number; slug: string; name: string; updated_at: Date | null };
  complements: { id: number; slug: string; updated_at: Date | null }[];
  /** Apps F2: the page the owner saved, or `null` (page as before F2). */
  page: AppPageDocument | null;
}

/**
 * The published product page of a store, reduced to what is still sold
 * online. `null` when the store has no published page or its featured
 * product stopped being sellable. Tenant comes only from `storeId`.
 */
export async function readPublishedProductPage(
  prisma: GlobalPrismaService,
  storeId: number,
): Promise<PublishedProductPage | null> {
  const app = await prisma.store_apps.findFirst({
    where: { store_id: storeId, kind: 'product_page', status: 'published' },
    select: { config: true },
  });
  if (!app) return null;

  const config = parseProductPageConfig(app.config);
  if (config.product_id === null) return null;

  const ids = [config.product_id, ...config.complement_product_ids];
  const rows = await prisma.products.findMany({
    where: sellableProductsWhere(storeId, ids),
    select: { id: true, slug: true, name: true, updated_at: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));

  const product = byId.get(config.product_id);
  if (!product) return null;

  return {
    product,
    complements: config.complement_product_ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => !!row)
      .map(({ id, slug, updated_at }) => ({ id, slug, updated_at })),
    page: readAppPage('product_page', app.config),
  };
}
