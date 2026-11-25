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

function finiteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

/**
 * Convierte un `EcommerceProduct` del catálogo público al modelo unificado de tarjeta.
 * Respeta el precio ya resuelto por el servidor (`final_price` y promoción plana activa
 * `active_promotion`, igual que `resolvePreviewProductCards` en el backend).
 */
export function mapEcommerceProductToItem(product: EcommerceProduct): AppPageProductItem {
  const baseFinal = finiteNumber(product.final_price, 0);
  const variants: AppPageProductVariant[] = (product.variants ?? []).map((v: ProductVariantDetail) => ({
    id: v.id,
    name: v.name?.trim() || v.sku || `Variante ${v.id}`,
    sku: v.sku ?? null,
    final_price: finiteNumber(v.final_price, baseFinal),
    regular_final_price: v.regular_final_price ?? null,
    is_on_sale: Boolean(v.is_on_sale),
    image_url: safeUrl(v.image_url ?? undefined),
    is_available: v.is_available !== false,
  }));

  const promo = product.active_promotion ?? null;
  const promoPrice = promo ? Number(promo.promotional_price) : NaN;
  // La promoción plana es un precio de PRODUCTO: si el producto expone
  // variantes, aplicarla dejaría la tarjeta más barata que cualquier variante y
  // el precio subiría al elegir una. Misma regla que `resolvePreviewProductCards`,
  // decidida con `variant_count` (no con `variants`, que solo llega cuando el
  // bloque muestra selectores) para que preview y público coincidan siempre.
  const exposedVariantCount =
    product.variant_count ?? variants.length;
  const hasExposedVariants =
    !product.sale_unit && exposedVariantCount > 0;
  const hasFlatPromo =
    !hasExposedVariants &&
    promo !== null &&
    promo.is_quantity_tiered !== true &&
    Number.isFinite(promoPrice) &&
    promoPrice > 0 &&
    promoPrice < baseFinal;

  const finalPrice = hasFlatPromo ? promoPrice : baseFinal;
  const regularFinalPrice = hasFlatPromo ? baseFinal : (product.regular_final_price ?? null);

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    image_url: safeUrl(product.image_url ?? undefined),
    final_price: finalPrice,
    regular_final_price: regularFinalPrice,
    // Misma regla que el preview: `is_on_sale` manda, sin exigir `sale_price`.
    is_on_sale: hasFlatPromo || Boolean(product.is_on_sale),
    variants,
  };
}

/**
 * Proyecta un `Product` del catálogo admin al modelo unificado solo como relleno
 * mientras el usuario elige productos nuevos antes de guardar. Nunca recalcula
 * precios: lee directamente el `final_price` entregado por el servidor.
 */
export function mapAdminProductToItem(product: Product): AppPageProductItem {
  const baseFinal = finiteNumber(product.final_price, 0);
  const rawVariants = (product.variants ?? product.product_variants ?? []) as Array<
    ProductVariant & { final_price?: number; regular_final_price?: number }
  >;

  const variants: AppPageProductVariant[] = rawVariants.map((v) => ({
    id: v.id,
    name: v.name?.trim() || v.sku || `Variante ${v.id}`,
    sku: v.sku ?? null,
    final_price: finiteNumber(v.final_price, baseFinal),
    regular_final_price:
      typeof v.regular_final_price === 'number' && Number.isFinite(v.regular_final_price)
        ? v.regular_final_price
        : null,
    is_on_sale: Boolean(v.is_on_sale),
    image_url: safeUrl(v.image_url ?? undefined),
    is_available: true,
  }));

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
