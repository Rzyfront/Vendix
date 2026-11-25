import { Injectable } from '@nestjs/common';
import { S3Service } from '@common/services/s3.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { StorefrontPriceService } from '../../../ecommerce/shared/services/storefront-price.service';
import { PromotionEngineService } from '../../promotions/promotion-engine/promotion-engine.service';
import {
  AUTO_PRODUCTS_FALLBACK_LIMIT,
  PreviewProductCard,
  PreviewProductRow,
  buildPreviewProductSelect,
  extractBlockProductIds,
  hasAutoProductsBlock,
  resolvePreviewProductCards,
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
  /** Productos elegidos manualmente en bloques `products` activos (en el orden configurado). */
  block_products?: PreviewProductCard[];
  /** Hasta 8 productos recientes de la tienda para bloques `products` en modo `auto` (no repite complementos). */
  auto_products?: PreviewProductCard[];
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
    private readonly storefrontPrice: StorefrontPriceService,
    private readonly promotionEngine: PromotionEngineService,
  ) {}

  async read(storeId: number, rawConfig: unknown): Promise<ProductPageViewData> {
    const config = parseProductPageConfig(rawConfig);
    const blockProductIds = extractBlockProductIds(rawConfig);
    const needsAutoProducts = hasAutoProductsBlock(rawConfig);
    if (
      config.product_id === null &&
      blockProductIds.length === 0 &&
      !needsAutoProducts
    ) {
      return { product: null, complements: [] };
    }

    const ids = Array.from(
      new Set([
        ...(config.product_id !== null ? [config.product_id] : []),
        ...config.complement_product_ids,
        ...blockProductIds,
      ]),
    );

    const [rows, autoRows] = await Promise.all([
      ids.length > 0
        ? ((this.globalPrisma.products.findMany({
            where: sellableProductsWhere(storeId, ids),
            select: buildPreviewProductSelect(true) as any,
          }) as unknown) as Promise<PreviewProductRow[]>)
        : Promise.resolve([] as PreviewProductRow[]),
      needsAutoProducts
        ? ((this.globalPrisma.products.findMany({
            where: {
              ...sellableProductsWhere(storeId, []),
              id: undefined,
            },
            orderBy: { created_at: 'desc' },
            take: AUTO_PRODUCTS_FALLBACK_LIMIT,
            select: buildPreviewProductSelect(false) as any,
          }) as unknown) as Promise<PreviewProductRow[]>)
        : Promise.resolve([] as PreviewProductRow[]),
    ]);

    const byId = new Map<number, PreviewProductRow>();
    for (const row of rows) byId.set(row.id, row);
    for (const row of autoRows) {
      if (!byId.has(row.id)) byId.set(row.id, row);
    }

    const { cardsById, defaultSaleUnits } = await resolvePreviewProductCards(
      Array.from(byId.values()),
      {
        prisma: this.globalPrisma as any,
        s3: this.s3,
        storefrontPrice: this.storefrontPrice,
        promotionEngine: this.promotionEngine,
      },
    );

    const featured = config.product_id !== null ? byId.get(config.product_id) : undefined;
    const featuredCard = featured ? cardsById.get(featured.id) : undefined;
    const product: ProductPageViewData['product'] = featured
      ? {
          id: featured.id,
          slug: featured.slug,
          name: featured.name,
          description: featured.description ?? null,
          image_url: featuredCard?.image_url ?? null,
          // Si el producto tiene presentación por defecto, en público no expone variantes.
          variants: defaultSaleUnits.has(featured.id)
            ? []
            : (featured.product_variants ?? []).map((v) => ({
                id: v.id,
                name: v.name?.trim() || v.sku || `Variante ${v.id}`,
              })),
        }
      : null;

    const complements: ProductPageViewData['complements'] = [];
    for (const id of config.complement_product_ids) {
      const card = cardsById.get(id);
      if (card) complements.push(card);
    }

    const result: ProductPageViewData = { product, complements };

    if (blockProductIds.length > 0) {
      const blockProducts: PreviewProductCard[] = [];
      for (const id of blockProductIds) {
        const card = cardsById.get(id);
        if (card) blockProducts.push(card);
      }
      result.block_products = blockProducts;
    }

    if (needsAutoProducts) {
      result.auto_products = autoRows
        .map((row) => cardsById.get(row.id))
        .filter((card): card is PreviewProductCard => !!card);
    }

    return result;
  }
}
