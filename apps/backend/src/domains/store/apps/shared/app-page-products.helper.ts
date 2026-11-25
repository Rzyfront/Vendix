import { S3Service } from '@common/services/s3.service';
import { calculateVariantFinalPrice } from '../../taxes/utils/final-price.util';
import { MAX_BLOCK_PRODUCT_IDS } from './app-page.contract';

/** Máximo de variantes proyectadas en la vista previa por producto. */
export const MAX_PREVIEW_PRODUCT_VARIANTS = 24;

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
  product_images?: { image_url?: string | null }[];
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
    product_images?: { image_url?: string | null } | null;
  }>;
}

export const PREVIEW_IMAGE_ORDER = [
  { is_main: 'desc' as const },
  { sort_order: 'asc' as const },
  { id: 'asc' as const },
];

/** Campos necesarios para proyectar una tarjeta de producto con precios finales y variantes. */
export function buildPreviewProductSelect(includeDescription = false) {
  return {
    id: true,
    slug: true,
    name: true,
    ...(includeDescription ? { description: true } : {}),
    base_price: true,
    sale_price: true,
    is_on_sale: true,
    product_images: {
      select: { image_url: true },
      orderBy: PREVIEW_IMAGE_ORDER,
      take: 1,
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
        product_images: { select: { image_url: true } },
      },
      orderBy: { id: 'asc' as const },
      take: MAX_PREVIEW_PRODUCT_VARIANTS,
    },
  };
}

/**
 * Extrae los `product_ids` configurados manualmente en los bloques `products`
 * de `config.page`, preservando orden, sin duplicados y respetando el tope.
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
    const b = block as { type?: unknown; props?: unknown };
    if (b.type !== 'products') continue;
    if (!b.props || typeof b.props !== 'object' || Array.isArray(b.props)) continue;
    const ids = (b.props as { product_ids?: unknown }).product_ids;
    if (!Array.isArray(ids)) continue;
    let blockCount = 0;
    for (const id of ids) {
      if (blockCount >= MAX_BLOCK_PRODUCT_IDS) break;
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) continue;
      blockCount += 1;
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

/**
 * Resuelve precio final (con impuestos, misma escalera que la página pública)
 * y firma las miniaturas de un producto y sus variantes.
 */
export async function mapPreviewProductCard(
  row: PreviewProductRow,
  s3: S3Service,
): Promise<PreviewProductCard> {
  const productLike = {
    base_price: row.base_price as number | string | null | undefined,
    sale_price: row.sale_price as number | string | null | undefined,
    is_on_sale: row.is_on_sale,
    product_tax_assignments: row.product_tax_assignments as any,
  };
  const regularProductLike = {
    ...productLike,
    is_on_sale: false,
    sale_price: null,
  };

  const finalPrice = calculateVariantFinalPrice(null, productLike);
  const regularFinalPrice = calculateVariantFinalPrice(null, regularProductLike);
  const imageUrl = (await s3.signUrl(row.product_images?.[0]?.image_url ?? undefined)) ?? null;

  const variants: PreviewProductVariant[] = [];
  for (const v of row.product_variants ?? []) {
    const variantLike = {
      price_override: v.price_override as number | string | null | undefined,
      sale_price: v.sale_price as number | string | null | undefined,
      is_on_sale: v.is_on_sale,
    };
    const regularVariantLike = {
      ...variantLike,
      is_on_sale: false,
      sale_price: null,
    };
    const variantImage = v.product_images?.image_url
      ? ((await s3.signUrl(v.product_images.image_url)) ?? null)
      : null;
    variants.push({
      id: v.id,
      name: v.name?.trim() || v.sku || `Variante ${v.id}`,
      sku: v.sku ?? null,
      final_price: calculateVariantFinalPrice(variantLike, productLike),
      regular_final_price: calculateVariantFinalPrice(regularVariantLike, regularProductLike),
      is_on_sale: Boolean(v.is_on_sale && Number(v.sale_price ?? 0) > 0),
      image_url: variantImage,
    });
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    image_url: imageUrl,
    final_price: finalPrice,
    regular_final_price: regularFinalPrice,
    is_on_sale: Boolean(row.is_on_sale && Number(row.sale_price ?? 0) > 0),
    variants,
  };
}
