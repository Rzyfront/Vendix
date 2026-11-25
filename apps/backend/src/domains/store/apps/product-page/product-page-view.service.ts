import { Injectable } from '@nestjs/common';
import { S3Service } from '@common/services/s3.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import {
  PreviewProductCard,
  PreviewProductRow,
  buildPreviewProductSelect,
  extractBlockProductIds,
  mapPreviewProductCard,
} from '../shared/app-page-products.helper';
import {
  parseProductPageConfig,
  sellableProductsWhere,
} from './product-page.reader';

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
  complements: PreviewProductCard[];
  /** Productos elegidos manualmente en bloques `products` (en el orden configurado). */
  block_products?: PreviewProductCard[];
}

/**
 * F6-B — the catalog data of the product page for the editor's preview
 * (`GET /store/apps/product_page/preview-context`). It applies the same
 * "sold online" rule the public read, the admin validation and the sitemap
 * use (`sellableProductsWhere`), so the preview shows the product the
 * published page would show, whatever the app's status (the owner previews
 * before publishing).
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
    const blockProductIds = extractBlockProductIds(rawConfig);
    if (config.product_id === null && blockProductIds.length === 0) {
      return { product: null, complements: [] };
    }

    const ids = Array.from(
      new Set([
        ...(config.product_id !== null ? [config.product_id] : []),
        ...config.complement_product_ids,
        ...blockProductIds,
      ]),
    );
    const rows = (await this.globalPrisma.products.findMany({
      where: sellableProductsWhere(storeId, ids),
      select: buildPreviewProductSelect(true) as any,
    })) as unknown as PreviewProductRow[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const sign = async (row: PreviewProductRow) =>
      (await this.s3.signUrl(row.product_images?.[0]?.image_url ?? undefined)) ?? null;

    const featured = config.product_id !== null ? byId.get(config.product_id) : undefined;
    const product: ProductPageViewData['product'] = featured
      ? {
          id: featured.id,
          slug: featured.slug,
          name: featured.name,
          description: featured.description ?? null,
          image_url: await sign(featured),
          variants: (featured.product_variants ?? []).map((v) => ({
            id: v.id,
            name: v.name?.trim() || v.sku || `Variante ${v.id}`,
          })),
        }
      : null;

    const complements: ProductPageViewData['complements'] = [];
    for (const id of config.complement_product_ids) {
      const row = byId.get(id);
      if (!row) continue;
      complements.push(await mapPreviewProductCard(row, this.s3));
    }

    if (blockProductIds.length === 0) {
      return { product, complements };
    }

    const blockProducts: PreviewProductCard[] = [];
    for (const id of blockProductIds) {
      const row = byId.get(id);
      if (!row) continue;
      blockProducts.push(await mapPreviewProductCard(row, this.s3));
    }
    return { product, complements, block_products: blockProducts };
  }
}
