import { Prisma } from '@prisma/client';
import {
  resolveLineUnits,
  roundMoney2,
  TypedTaxRate,
} from '../../taxes/utils/final-price.util';
import { resolveLineTotals } from '../../taxes/utils/tax-inclusive-math.util';
import { TaxFiscalType } from '../../taxes/dto';
import { resolvePriceUnitScale } from '../../products/services/price-unit.util';

/**
 * Extraído de `TableSessionsService.addItems` (QUI-650) para que la cuenta
 * abierta y el editor de líneas de orden (`OrderItemChangesService`) calculen
 * precio y tax de catálogo con UNA sola definición.
 *
 * Fila de impuesto COMPLETA de una línea: lo que se persiste tal cual en
 * `order_item_taxes`. `tax_type` e `is_inclusive` son obligatorios a
 * propósito (ver historia QUI-INC: un resolver que no los traiga no compila).
 */
export type FullTaxRow = TypedTaxRate & {
  tax_rate_id: number;
  name: string;
  tax_type: TaxFiscalType;
};

/** Cliente mínimo (prisma scoped o tx) para leer asignaciones de impuesto. */
export interface TaxAssignmentsReader {
  product_tax_assignments: { findMany: (args: any) => Promise<any[]> };
}

/**
 * UN batch (no N+1) de `product_tax_assignments`; conserva
 * `tax_rate_id`/`name`/`tax_type` para crear filas `order_item_taxes`.
 * Precedencia de `is_inclusive`: asignación → tasa → false.
 */
export async function resolveFullTaxRowsByProductId(
  client: TaxAssignmentsReader,
  productIds: number[],
): Promise<Map<number, FullTaxRow[]>> {
  const out = new Map<number, FullTaxRow[]>();
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return out;
  const assignments = await client.product_tax_assignments.findMany({
    where: { product_id: { in: ids } },
    include: {
      tax_categories: { include: { tax_rates: true } },
    },
  });
  for (const assignment of assignments as Array<{
    product_id: number;
    is_inclusive?: boolean | null;
    tax_categories?: {
      tax_type?: string | null;
      tax_rates?: Array<{
        id: number;
        name: string;
        rate: Prisma.Decimal | number;
        is_inclusive?: boolean | null;
      } | null> | null;
    } | null;
  }>) {
    const rates = assignment.tax_categories?.tax_rates ?? [];
    if (rates.length === 0) continue;
    // `tax_categories` es la dueña única de `tax_type`: acá «sin tipar»
    // significa IVA (igual que `TaxesService.calculateProductTaxes`).
    const taxType =
      (assignment.tax_categories?.tax_type as TaxFiscalType | null) ??
      TaxFiscalType.IVA;
    const assignmentInclusive = assignment.is_inclusive ?? undefined;
    const list = out.get(assignment.product_id) ?? [];
    for (const rate of rates) {
      if (rate == null) continue;
      list.push({
        tax_rate_id: rate.id,
        name: rate.name,
        rate: Number(rate.rate),
        tax_type: taxType,
        is_inclusive: assignmentInclusive ?? rate.is_inclusive ?? false,
      });
    }
    out.set(assignment.product_id, list);
  }
  return out;
}

export interface CatalogPriceVariant {
  price_override?: Prisma.Decimal | number | null;
  is_on_sale?: boolean | null;
  sale_price?: Prisma.Decimal | number | null;
}

export interface CatalogPriceProduct {
  base_price?: Prisma.Decimal | number | null;
  is_on_sale?: boolean | null;
  sale_price?: Prisma.Decimal | number | null;
}

/**
 * Escalera de precio de catálogo (misma que el cobro POS):
 * oferta de variante → override de variante → oferta del producto → base.
 */
export function resolveCatalogUnitPrice(
  product: CatalogPriceProduct,
  variant?: CatalogPriceVariant | null,
): number {
  const salePrice =
    variant?.is_on_sale === true ? Number(variant.sale_price ?? 0) : 0;
  const overridePrice = Number(
    (variant?.price_override as number | null | undefined) ?? NaN,
  );
  const productSalePrice =
    product.is_on_sale === true ? Number(product.sale_price ?? 0) : 0;
  return salePrice > 0
    ? salePrice
    : Number.isFinite(overridePrice) && overridePrice > 0
      ? (overridePrice as number)
      : productSalePrice > 0
        ? productSalePrice
        : Number(product.base_price ?? 0);
}

export interface CatalogLineResolution {
  catalogUnitPrice: number;
  priceUnitQuantity: number;
  lineUnits: number;
  unitBase: number;
  totalPrice: number;
  /** POR UNIDAD de precio (nunca por línea). */
  taxAmountItem: number;
  taxRate: number;
  finalUnitPrice: number;
  /** Filas de `order_item_taxes` ya multiplicadas por `lineUnits`. */
  taxRows: Array<{
    row: FullTaxRow;
    tax_amount: number;
    index: number;
  }>;
}

/** Despeje de una línea de catálogo: base, impuesto, bruto y filas de tax. */
export function resolveCatalogLine(input: {
  catalogUnitPrice: number;
  quantity: number;
  priceUnitQuantityRaw: unknown;
  rows: FullTaxRow[];
}): CatalogLineResolution {
  const priceUnitQuantity = resolvePriceUnitScale(input.priceUnitQuantityRaw);
  const lineUnits = resolveLineUnits({
    quantity: input.quantity,
    price_unit_quantity: priceUnitQuantity,
  });
  const resolved = resolveLineTotals(input.catalogUnitPrice, input.rows);
  const unitBase = resolved.base;
  return {
    catalogUnitPrice: input.catalogUnitPrice,
    priceUnitQuantity,
    lineUnits,
    unitBase,
    totalPrice: roundMoney2(unitBase * lineUnits),
    taxAmountItem: roundMoney2(resolved.total_tax_amount),
    taxRate: Math.round((resolved.total_rate + Number.EPSILON) * 100000) / 100000,
    finalUnitPrice: roundMoney2(resolved.total),
    taxRows: input.rows.map((row, index) => ({
      row,
      index,
      tax_amount: roundMoney2(resolved.taxes[index].amount * lineUnits),
    })),
  };
}
