import type { EcommerceProduct, ProductVariantDetail } from '../../private/modules/ecommerce/services/catalog.service';
import type { Product, ProductVariant } from '../../private/modules/store/products/interfaces/product.interface';
import {
  AppProductsLayout,
  AppProductsSelection,
  MAX_BLOCK_PRODUCT_IDS,
} from '../../private/modules/store/apps/templates/app-page.types';
import { blockEnum, safeUrl } from './app-page-view.util';

/** Variante proyectada para las tarjetas del bloque `products` (vista previa y página pública). */
export interface AppPageProductVariant {
  id: number;
  name: string;
  sku?: string | null;
  final_price: number;
  regular_final_price?: number | null;
  is_on_sale?: boolean;
  price_override?: number | null;
  sale_price?: number | null;
  image_url?: string | null;
  is_available?: boolean;
}

/** Producto proyectado para las tarjetas del bloque `products` (vista previa y página pública). */
export interface AppPageProductItem {
  id: number;
  slug: string;
  name: string;
  image_url: string | null;
  final_price: number;
  regular_final_price?: number | null;
  is_on_sale?: boolean;
  variants: AppPageProductVariant[];
}

export interface ResolvedCardPrice {
  price: number;
  compareAt: number | null;
  onSale: boolean;
}

export const PRODUCTS_SELECTIONS: readonly AppProductsSelection[] = ['auto', 'manual'];
export const PRODUCTS_LAYOUTS: readonly AppProductsLayout[] = ['grid', 'list', 'carousel'];

function finitePositive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Resuelve el precio mostrado en una tarjeta de producto con la misma escalera
 * que la página pública (`product-detail.component.ts` / `final-price.util.ts`):
 * variante seleccionada (final_price de la variante > sale > override > producto)
 * o precio final del producto si no hay variante elegida.
 */
export function resolveProductCardPrice(
  product: AppPageProductItem,
  selectedVariantId: number | null,
): ResolvedCardPrice {
  const basePrice = finiteNumber(product.final_price, 0);
  const variant =
    selectedVariantId !== null
      ? (product.variants.find((v) => v.id === selectedVariantId) ?? null)
      : null;

  if (variant) {
    let price: number;
    if (typeof variant.final_price === 'number' && Number.isFinite(variant.final_price)) {
      price = variant.final_price;
    } else if (variant.is_on_sale && finitePositive(variant.sale_price) !== null) {
      price = finitePositive(variant.sale_price)!;
    } else if (finitePositive(variant.price_override) !== null) {
      price = finitePositive(variant.price_override)!;
    } else {
      price = basePrice;
    }
    const regular = finitePositive(variant.regular_final_price);
    const compareAt = regular !== null && regular > price ? regular : null;
    return {
      price,
      compareAt,
      onSale: compareAt !== null || Boolean(variant.is_on_sale),
    };
  }

  const regular = finitePositive(product.regular_final_price);
  const compareAt = regular !== null && regular > basePrice ? regular : null;
  return {
    price: basePrice,
    compareAt,
    onSale: compareAt !== null || Boolean(product.is_on_sale),
  };
}

/**
 * Ordena una lista de productos respetando estrictamente el orden de `ids`,
 * eliminando duplicados e IDs inválidos, y aplicando el límite máximo (50).
 */
export function orderProductsByIds<T extends { id: number }>(
  items: readonly T[],
  ids: readonly number[],
  max = MAX_BLOCK_PRODUCT_IDS,
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<number>();
  const out: T[] = [];
  for (const id of ids) {
    if (out.length >= max) break;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || seen.has(id)) continue;
    const match = byId.get(id);
    if (!match) continue;
    seen.add(id);
    out.push(match);
  }
  return out;
}

/** Lee `product_ids` de las props de un bloque: enteros positivos únicos en orden (máx. 50). */
export function blockProductIds(props: Record<string, unknown>, max = MAX_BLOCK_PRODUCT_IDS): number[] {
  const raw = props['product_ids'];
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const item of raw) {
    if (out.length >= max) break;
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 1) continue;
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

export function blockProductsSelection(props: Record<string, unknown>): AppProductsSelection | null {
  return blockEnum(props, 'selection', PRODUCTS_SELECTIONS);
}

export function blockProductsLayout(props: Record<string, unknown>): AppProductsLayout | null {
  return blockEnum(props, 'layout', PRODUCTS_LAYOUTS);
}

export function blockShowVariants(props: Record<string, unknown>): boolean {
  return props['show_variants'] === true;
}

/** Convierte un `EcommerceProduct` del catálogo público al modelo unificado de tarjeta. */
export function mapEcommerceProductToItem(product: EcommerceProduct): AppPageProductItem {
  const variants: AppPageProductVariant[] = (product.variants ?? []).map((v: ProductVariantDetail) => ({
    id: v.id,
    name: v.name?.trim() || v.sku || `Variante ${v.id}`,
    sku: v.sku ?? null,
    final_price: finiteNumber(v.final_price, finiteNumber(product.final_price, 0)),
    regular_final_price: v.regular_final_price ?? null,
    is_on_sale: Boolean(v.is_on_sale),
    price_override: v.price_override ?? null,
    sale_price: v.sale_price ?? null,
    image_url: safeUrl(v.image_url ?? undefined),
    is_available: v.is_available !== false,
  }));

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    image_url: safeUrl(product.image_url ?? undefined),
    final_price: finiteNumber(product.final_price, finiteNumber(product.base_price, 0)),
    regular_final_price: product.regular_final_price ?? null,
    is_on_sale: Boolean(product.is_on_sale),
    variants,
  };
}

/** Convierte un `Product` del catálogo admin (selector / vista previa en vivo) al modelo unificado. */
export function mapAdminProductToItem(product: Product): AppPageProductItem {
  const baseFinal = finiteNumber(
    product.final_price,
    product.is_on_sale && finitePositive(product.sale_price) !== null
      ? finitePositive(product.sale_price)!
      : finiteNumber(product.base_price, 0),
  );
  const rawVariants = (product.variants ?? product.product_variants ?? []) as Array<
    ProductVariant & { final_price?: number; regular_final_price?: number }
  >;

  const variants: AppPageProductVariant[] = rawVariants.map((v) => {
    const fallbackVariantPrice =
      v.is_on_sale && finitePositive(v.sale_price) !== null
        ? finitePositive(v.sale_price)!
        : finitePositive(v.price_override) !== null
          ? finitePositive(v.price_override)!
          : baseFinal;
    return {
      id: v.id,
      name: v.name?.trim() || v.sku || `Variante ${v.id}`,
      sku: v.sku ?? null,
      final_price: typeof v.final_price === 'number' && Number.isFinite(v.final_price) ? v.final_price : fallbackVariantPrice,
      regular_final_price:
        typeof v.regular_final_price === 'number' && Number.isFinite(v.regular_final_price)
          ? v.regular_final_price
          : null,
      is_on_sale: Boolean(v.is_on_sale),
      price_override: v.price_override ?? null,
      sale_price: v.sale_price ?? null,
      image_url: safeUrl(v.image_url ?? undefined),
      is_available: true,
    };
  });

  const thumb = product.image_url ?? product.product_images?.[0]?.image_url ?? product.images?.[0]?.image_url;
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    image_url: safeUrl(thumb ?? undefined),
    final_price: baseFinal,
    regular_final_price: null,
    is_on_sale: Boolean(product.is_on_sale),
    variants,
  };
}
