import type { StorefrontPriceService } from '../../../ecommerce/shared/services/storefront-price.service';
import {
  resolveDefaultSaleUnits,
  type DefaultSaleUnit,
} from '../../products/services/default-sale-unit.util';
import type {
  ActiveProductPromotion,
  ActivePromotionProductInput,
} from '../../promotions/dto/promotion-quote.interface';
import { MAX_BLOCK_PRODUCT_IDS } from './app-page.contract';

/** Máximo de variantes proyectadas en la vista previa por producto. */
export const MAX_PREVIEW_PRODUCT_VARIANTS = 24;

/** Cantidad de productos automáticos en el bloque `products` de Product Page (modo `auto`). */
export const AUTO_PRODUCTS_FALLBACK_LIMIT = 8;

export interface PreviewProductVariant {
  id: number;
  name: string;
  sku: string | null;
  final_price: number;
  regular_final_price: number;
  is_on_sale: boolean;
  image_url: string | null;
}

export interface PreviewProductCard {
  id: number;
  slug: string;
  name: string;
  image_url: string | null;
  final_price: number;
  regular_final_price: number;
  is_on_sale: boolean;
  active_promotion: ActiveProductPromotion | null;
  variants: PreviewProductVariant[];
}

/** Fila mínima leída desde Prisma para proyectar tarjetas con precio final y variantes. */
export interface PreviewProductRow {
  id: number;
  slug: string;
  name: string;
  description?: string | null;
  base_price?: unknown;
  sale_price?: unknown;
  is_on_sale?: boolean | null;
  track_inventory?: boolean | null;
  product_images?: { image_url?: string | null }[];
  product_categories?: Array<{ category_id?: number | null; categories?: { id?: number | null } | null }> | null;
  product_tax_assignments?: Array<{
    is_inclusive?: boolean | null;
    tax_categories?: {
      is_inclusive?: boolean | null;
      tax_rates?: Array<{ rate: unknown; is_inclusive?: boolean | null }> | null;
    } | null;
  }> | null;
  product_variants?: Array<{
    id: number;
    name?: string | null;
    sku?: string | null;
    price_override?: unknown;
    sale_price?: unknown;
    is_on_sale?: boolean | null;
    track_inventory_override?: boolean | null;
    product_images?: { image_url?: string | null } | null;
  }>;
}

/** Dependencias para proyectar tarjetas de vista previa con la misma resolución que el catálogo público. */
export interface PreviewProductResolverDeps {
  prisma: {
    product_price_tier_assignments?: { findMany: (args: any) => Promise<any[]> };
    product_price_tier_overrides?: { findMany: (args: any) => Promise<any[]> };
  };
  s3: { signUrl: (key?: string | null) => Promise<string | undefined | null> };
  storefrontPrice: Pick<
    StorefrontPriceService,
    'resolveCatalogFinalPrice' | 'resolveCatalogRegularFinalPrice'
  >;
  promotionEngine?: {
    findActiveAutoPromotionsForProducts: (
      products: ActivePromotionProductInput[],
    ) => Promise<Map<number, ActiveProductPromotion>>;
  } | null;
}

export const PREVIEW_IMAGE_ORDER = [
  { is_main: 'desc' as const },
  { sort_order: 'asc' as const },
  { id: 'asc' as const },
];

/** Campos necesarios para proyectar una tarjeta de producto con precios finales, promociones y variantes. */
export function buildPreviewProductSelect(includeDescription = false) {
  return {
    id: true,
    slug: true,
    name: true,
    ...(includeDescription ? { description: true } : {}),
    base_price: true,
    sale_price: true,
    is_on_sale: true,
    track_inventory: true,
    product_images: {
      select: { image_url: true },
      orderBy: PREVIEW_IMAGE_ORDER,
      take: 1,
    },
    product_categories: {
      select: { category_id: true },
    },
    product_tax_assignments: {
      select: {
        is_inclusive: true,
        tax_categories: {
          select: {
            is_inclusive: true,
            tax_rates: {
              select: { rate: true, is_inclusive: true },
            },
          },
        },
      },
    },
    product_variants: {
      select: {
        id: true,
        name: true,
        sku: true,
        price_override: true,
        sale_price: true,
        is_on_sale: true,
        track_inventory_override: true,
        product_images: { select: { image_url: true } },
      },
      orderBy: { id: 'asc' as const },
      take: MAX_PREVIEW_PRODUCT_VARIANTS,
    },
  };
}

/**
 * Extrae los `product_ids` configurados manualmente en los bloques `products`
 * activos (`enabled !== false && selection === 'manual'`) de `config.page`,
 * preservando el orden, sin duplicados y respetando el tope (`MAX_BLOCK_PRODUCT_IDS`).
 */
export function extractBlockProductIds(rawConfig: unknown): number[] {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return [];
  }
  const page = (rawConfig as { page?: unknown }).page;
  if (!page || typeof page !== 'object' || Array.isArray(page)) return [];
  const blocks = (page as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return [];

  const seen = new Set<number>();
  const out: number[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    const b = block as { type?: unknown; enabled?: unknown; props?: unknown };
    if (b.type !== 'products') continue;
    if (b.enabled === false) continue;
    if (!b.props || typeof b.props !== 'object' || Array.isArray(b.props)) continue;
    const props = b.props as { selection?: unknown; product_ids?: unknown };
    if (props.selection !== 'manual') continue;
    const ids = props.product_ids;
    if (!Array.isArray(ids)) continue;
    let blockCount = 0;
    for (const id of ids) {
      if (blockCount >= MAX_BLOCK_PRODUCT_IDS || out.length >= MAX_BLOCK_PRODUCT_IDS) break;
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || seen.has(id)) continue;
      blockCount += 1;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Indica si la página tiene al menos un bloque `products` activo en modo
 * automático (`selection !== 'manual'`). En Product Page ese bloque muestra
 * hasta 8 productos recientes del catálogo (no repite los complementos).
 */
export function hasAutoProductsBlock(rawConfig: unknown): boolean {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return false;
  }
  const page = (rawConfig as { page?: unknown }).page;
  if (!page || typeof page !== 'object' || Array.isArray(page)) return false;
  const blocks = (page as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return false;

  for (const block of blocks) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    const b = block as { type?: unknown; enabled?: unknown; props?: unknown };
    if (b.type !== 'products' || b.enabled === false) continue;
    const selection =
      b.props && typeof b.props === 'object' && !Array.isArray(b.props)
        ? (b.props as { selection?: unknown }).selection
        : undefined;
    if (selection !== 'manual') return true;
  }
  return false;
}

/**
 * Hidrata en lote presentaciones por defecto (`resolveDefaultSaleUnits`) para un
 * conjunto de productos. Si las tablas no están disponibles o la lectura falla,
 * degrada a mapa vacío (igual que `CatalogService.hydrateSaleUnitsForListing`).
 */
export async function resolvePreviewDefaultSaleUnits(
  prisma: PreviewProductResolverDeps['prisma'],
  productIds: number[],
): Promise<Map<number, DefaultSaleUnit>> {
  if (
    productIds.length === 0 ||
    !prisma?.product_price_tier_assignments?.findMany ||
    !prisma?.product_price_tier_overrides?.findMany
  ) {
    return new Map();
  }
  try {
    return await resolveDefaultSaleUnits(
      {
        product_price_tier_assignments: prisma.product_price_tier_assignments,
        product_price_tier_overrides: prisma.product_price_tier_overrides,
      },
      productIds,
    );
  } catch {
    return new Map();
  }
}

/**
 * Proyecta en lote un conjunto de filas de productos a tarjetas de vista previa
 * usando el MISMO motor de precio que el catálogo público:
 * - `StorefrontPriceService.resolveCatalogFinalPrice` (impuestos + presentación por defecto)
 * - `PromotionEngineService.findActiveAutoPromotionsForProducts` (promociones automáticas)
 * - Regla de exclusión: un producto con presentación por defecto no expone variantes
 *   (idéntico a `CatalogService.mapVariantsToResponse`).
 */
export async function resolvePreviewProductCards(
  rows: PreviewProductRow[],
  deps: PreviewProductResolverDeps,
): Promise<{
  cardsById: Map<number, PreviewProductCard>;
  defaultSaleUnits: Map<number, DefaultSaleUnit>;
}> {
  const cardsById = new Map<number, PreviewProductCard>();
  if (rows.length === 0) {
    return { cardsById, defaultSaleUnits: new Map() };
  }

  const rowIds = rows.map((r) => r.id);
  const defaultSaleUnits = await resolvePreviewDefaultSaleUnits(deps.prisma, rowIds);

  // 1. Precio base resuelto (impuestos + presentación por defecto) — base para promociones.
  const baseFinals = new Map<number, { finalPrice: number; regularFinalPrice: number }>();
  const promoInputs: ActivePromotionProductInput[] = [];
  for (const row of rows) {
    const saleUnit = defaultSaleUnits.get(row.id) ?? null;
    const productInput = {
      base_price: row.base_price,
      sale_price: row.sale_price,
      is_on_sale: Boolean(row.is_on_sale),
      track_inventory: Boolean(row.track_inventory),
      product_tax_assignments: row.product_tax_assignments ?? [],
    };
    const finalPrice = deps.storefrontPrice.resolveCatalogFinalPrice(productInput, null, saleUnit);
    const regularFinalPrice = deps.storefrontPrice.resolveCatalogRegularFinalPrice(
      productInput,
      null,
      saleUnit,
    );
    baseFinals.set(row.id, { finalPrice, regularFinalPrice });

    if (Number.isFinite(finalPrice) && finalPrice > 0) {
      const categoryIds = (row.product_categories ?? [])
        .map((pc) => Number(pc?.categories?.id ?? pc?.category_id))
        .filter((id) => Number.isFinite(id));
      promoInputs.push({
        product_id: row.id,
        category_ids: categoryIds,
        unit_price: finalPrice,
      });
    }
  }

  // 2. Promociones automáticas activas en lote (mismo comportamiento fail-open que CatalogService).
  let promotionsByProductId = new Map<number, ActiveProductPromotion>();
  if (deps.promotionEngine && promoInputs.length > 0) {
    try {
      promotionsByProductId =
        await deps.promotionEngine.findActiveAutoPromotionsForProducts(promoInputs);
    } catch {
      promotionsByProductId = new Map();
    }
  }

  // 3. Proyección final de cada tarjeta (precio efectivo + variantes).
  await Promise.all(
    rows.map(async (row) => {
      const saleUnit = defaultSaleUnits.get(row.id) ?? null;
      const base = baseFinals.get(row.id) ?? { finalPrice: 0, regularFinalPrice: 0 };
      const promo = promotionsByProductId.get(row.id) ?? null;
      const hasFlatPromo =
        promo !== null &&
        promo.is_quantity_tiered !== true &&
        Number.isFinite(promo.promotional_price) &&
        promo.promotional_price > 0 &&
        promo.promotional_price < base.finalPrice;

      const finalPrice = hasFlatPromo ? promo.promotional_price : base.finalPrice;
      const regularFinalPrice = hasFlatPromo ? base.finalPrice : base.regularFinalPrice;
      const isOnSale =
        hasFlatPromo ||
        regularFinalPrice > finalPrice ||
        Boolean(row.is_on_sale && Number(row.sale_price ?? 0) > 0);

      const imageUrl =
        (await deps.s3.signUrl(row.product_images?.[0]?.image_url ?? undefined)) ?? null;

      // Multi-tarifa ⊕ variantes: si el producto tiene presentación por defecto,
      // no expone variantes (idéntico a CatalogService.mapVariantsToResponse).
      const variants: PreviewProductVariant[] = [];
      if (!saleUnit) {
        const productInput = {
          base_price: row.base_price,
          sale_price: row.sale_price,
          is_on_sale: Boolean(row.is_on_sale),
          track_inventory: Boolean(row.track_inventory),
          product_tax_assignments: row.product_tax_assignments ?? [],
        };
        for (const v of row.product_variants ?? []) {
          const variantInput = {
            id: v.id,
            price_override: v.price_override,
            sale_price: v.sale_price,
            is_on_sale: Boolean(v.is_on_sale),
            track_inventory_override: v.track_inventory_override ?? null,
          };
          const variantFinal = deps.storefrontPrice.resolveCatalogFinalPrice(
            productInput,
            variantInput,
            null,
          );
          const variantRegular = deps.storefrontPrice.resolveCatalogRegularFinalPrice(
            productInput,
            variantInput,
            null,
          );
          const variantImage = v.product_images?.image_url
            ? ((await deps.s3.signUrl(v.product_images.image_url)) ?? null)
            : null;
          variants.push({
            id: v.id,
            name: v.name?.trim() || v.sku || `Variante ${v.id}`,
            sku: v.sku ?? null,
            final_price: variantFinal,
            regular_final_price: variantRegular,
            is_on_sale:
              Boolean(v.is_on_sale && Number(v.sale_price ?? 0) > 0) ||
              variantRegular > variantFinal,
            image_url: variantImage,
          });
        }
      }

      cardsById.set(row.id, {
        id: row.id,
        slug: row.slug,
        name: row.name,
        image_url: imageUrl,
        final_price: finalPrice,
        regular_final_price: regularFinalPrice,
        is_on_sale: isOnSale,
        active_promotion: promo,
        variants,
      });
    }),
  );

  return { cardsById, defaultSaleUnits };
}
