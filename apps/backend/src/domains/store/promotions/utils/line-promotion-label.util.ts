/**
 * Etiqueta de la promoción por línea (display-only, aditivo).
 *
 * `order_items` no guarda qué promoción produjo su `discount_amount`; el
 * detalle de la orden y la cuenta de mesa necesitan nombrarla junto al
 * precio tachado. Solo se etiquetan líneas con descuento > 0:
 *
 *  a) Promociones registradas en `order_promotions` (descuento > 0) cuyo
 *     alcance cubre la línea: `scope='order'` cubre todas; `product` por
 *     `promotion_products`; `category` por `promotion_categories`.
 *  b) Sin ninguna registrada que la cubra (cuenta de mesa abierta: aún no
 *     registra `order_promotions`), la promo automática vigente del mismo
 *     motor (`findActiveAutoPromotionsForProducts`) para el producto.
 *  c) Fallback "Promoción".
 */

import type { ActivePromotionProductInput } from '../dto/promotion-quote.interface';

export const DEFAULT_PROMOTION_LABEL = 'Promoción';

export interface PromotionLabelLine {
  id: number;
  product_id: number | null;
  discount_amount?: unknown;
  unit_price?: unknown;
  /** Categorías del producto (para promos `scope='category'`). */
  category_ids?: number[];
}

export interface RegisteredLinePromotion {
  discount_amount?: unknown;
  name: string;
  scope: string;
  product_ids: number[];
  category_ids: number[];
}

/** Firma de `PromotionEngineService.findActiveAutoPromotionsForProducts`. */
export type ActivePromotionLookup = (
  products: ActivePromotionProductInput[],
) => Promise<Map<number, { name: string }>>;

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const coversLine = (
  promo: RegisteredLinePromotion,
  line: PromotionLabelLine,
): boolean => {
  if (promo.scope === 'order') return true;
  if (line.product_id == null) return false;
  if (promo.scope === 'product') {
    return promo.product_ids.includes(line.product_id);
  }
  if (promo.scope === 'category') {
    const lineCategories = line.category_ids ?? [];
    return promo.category_ids.some((id) => lineCategories.includes(id));
  }
  return false;
};

/**
 * Devuelve `Map<order_item_id, etiqueta>` SOLO para líneas con descuento.
 * El motor se consulta una vez, en lote, y solo para las líneas que no
 * quedaron cubiertas por una promo registrada. Un fallo del motor no rompe
 * la respuesta: cae al fallback.
 */
export async function resolveLinePromotionLabels(
  lines: PromotionLabelLine[],
  registered: RegisteredLinePromotion[],
  lookup?: ActivePromotionLookup | null,
): Promise<Map<number, string>> {
  const labels = new Map<number, string>();
  const charged = registered.filter((promo) => num(promo.discount_amount) > 0);
  const pending: PromotionLabelLine[] = [];

  for (const line of lines) {
    if (num(line.discount_amount) <= 0) continue;
    const names = [
      ...new Set(
        charged
          .filter((promo) => coversLine(promo, line))
          .map((promo) => promo.name.trim())
          .filter(Boolean),
      ),
    ];
    if (names.length > 0) {
      labels.set(line.id, names.join(' + '));
    } else {
      pending.push(line);
    }
  }

  if (pending.length === 0) return labels;

  let active = new Map<number, { name: string }>();
  const withProduct = pending.filter((line) => line.product_id != null);
  if (lookup && withProduct.length > 0) {
    try {
      active = await lookup(
        withProduct.map((line) => ({
          product_id: line.product_id as number,
          category_ids: line.category_ids ?? [],
          // El motor descarta precios <= 0; solo se usa el nombre.
          unit_price: num(line.unit_price) > 0 ? num(line.unit_price) : 1,
        })),
      );
    } catch {
      active = new Map();
    }
  }

  for (const line of pending) {
    const name =
      line.product_id != null
        ? active.get(line.product_id)?.name?.trim()
        : undefined;
    labels.set(line.id, name || DEFAULT_PROMOTION_LABEL);
  }
  return labels;
}

interface LabelPrismaClient {
  order_promotions: { findMany: (args: any) => Promise<any[]> };
  product_categories: { findMany: (args: any) => Promise<any[]> };
}

/**
 * Carga lo necesario (promos registradas de la orden con su alcance y las
 * categorías de los productos con descuento) y resuelve las etiquetas.
 * Sin líneas con descuento no consulta nada.
 */
export async function loadLinePromotionLabels(
  prisma: LabelPrismaClient,
  orderId: number,
  lines: PromotionLabelLine[],
  lookup?: ActivePromotionLookup | null,
): Promise<Map<number, string>> {
  const discounted = lines.filter((line) => num(line.discount_amount) > 0);
  if (discounted.length === 0) return new Map();

  const productIds = [
    ...new Set(
      discounted
        .map((line) => line.product_id)
        .filter((id): id is number => id != null),
    ),
  ];
  const [promotionRows, categoryRows] = await Promise.all([
    prisma.order_promotions.findMany({
      where: { order_id: orderId, discount_amount: { gt: 0 } },
      select: {
        discount_amount: true,
        promotions: {
          select: {
            name: true,
            scope: true,
            promotion_products: { select: { product_id: true } },
            promotion_categories: { select: { category_id: true } },
          },
        },
      },
    }),
    productIds.length > 0
      ? prisma.product_categories.findMany({
          where: { product_id: { in: productIds } },
          select: { product_id: true, category_id: true },
        })
      : Promise.resolve([]),
  ]);

  const categoriesByProduct = new Map<number, number[]>();
  for (const row of categoryRows ?? []) {
    const list = categoriesByProduct.get(row.product_id) ?? [];
    list.push(Number(row.category_id));
    categoriesByProduct.set(row.product_id, list);
  }

  const registered: RegisteredLinePromotion[] = (promotionRows ?? [])
    .filter((row) => row?.promotions)
    .map((row) => ({
      discount_amount: row.discount_amount,
      name: String(row.promotions.name ?? ''),
      scope: String(row.promotions.scope ?? ''),
      product_ids: (row.promotions.promotion_products ?? []).map((pp: any) =>
        Number(pp.product_id),
      ),
      category_ids: (row.promotions.promotion_categories ?? []).map(
        (pc: any) => Number(pc.category_id),
      ),
    }));

  return resolveLinePromotionLabels(
    discounted.map((line) => ({
      ...line,
      category_ids:
        line.product_id != null
          ? (categoriesByProduct.get(line.product_id) ?? [])
          : [],
    })),
    registered,
    lookup,
  );
}
