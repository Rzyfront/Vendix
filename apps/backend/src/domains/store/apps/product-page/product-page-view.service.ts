import { Injectable } from '@nestjs/common';
import { S3Service } from '@common/services/s3.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import {
  parseProductPageConfig,
  sellableProductsWhere,
} from './product-page.reader';

/** Variants listed in the editor's preview (the page shows them all; this only bounds the payload). */
const MAX_PREVIEW_VARIANTS = 24;

/** What the product page paints from the store's catalog: the featured product and its complements. */
export interface ProductPageViewData {
  /** `null` when no product is chosen or it stopped being sellable online. */
  product: {
    id: number;
    slug: string;
    name: string;
    description: string | null;
    image_url: string | null;
    variants: { id: number; name: string }[];
  } | null;
  complements: {
    id: number;
    slug: string;
    name: string;
    image_url: string | null;
  }[];
}

/**
 * F6-B — the catalog data of the product page for the editor's preview
 * (`GET /store/apps/product_page/preview-context`). It applies the same
 * "sold online" rule the public read, the admin validation and the sitemap
 * use (`sellableProductsWhere`), so the preview shows the product the
 * published page would show, whatever the app's status (the owner previews
 * before publishing). Prices are not part of it: the public page gets them
 * from the store's own product detail.
 *
 * Tenant isolation: every query filters by the `storeId` the caller resolved
 * from the request context (JWT), through `sellableProductsWhere`.
 */
@Injectable()
export class ProductPageViewService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly s3: S3Service,
  ) {}

  async read(storeId: number, rawConfig: unknown): Promise<ProductPageViewData> {
    const config = parseProductPageConfig(rawConfig);
    if (config.product_id === null) return { product: null, complements: [] };

    const ids = [config.product_id, ...config.complement_product_ids];
    const rows = await this.globalPrisma.products.findMany({
      where: sellableProductsWhere(storeId, ids),
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        product_images: {
          select: { image_url: true },
          orderBy: [{ is_main: 'desc' }, { sort_order: 'asc' }, { id: 'asc' }],
          take: 1,
        },
        product_variants: {
          select: { id: true, name: true, sku: true },
          orderBy: { id: 'asc' },
          take: MAX_PREVIEW_VARIANTS,
        },
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const sign = async (row: (typeof rows)[number]) =>
      (await this.s3.signUrl(row.product_images[0]?.image_url)) ?? null;

    const featured = byId.get(config.product_id);
    const product: ProductPageViewData['product'] = featured
      ? {
          id: featured.id,
          slug: featured.slug,
          name: featured.name,
          description: featured.description ?? null,
          image_url: await sign(featured),
          variants: featured.product_variants.map((v) => ({
            id: v.id,
            name: v.name?.trim() || v.sku,
          })),
        }
      : null;

    const complements: ProductPageViewData['complements'] = [];
    for (const id of config.complement_product_ids) {
      const row = byId.get(id);
      if (!row) continue;
      complements.push({
        id: row.id,
        slug: row.slug,
        name: row.name,
        image_url: await sign(row),
      });
    }
    return { product, complements };
  }
}
