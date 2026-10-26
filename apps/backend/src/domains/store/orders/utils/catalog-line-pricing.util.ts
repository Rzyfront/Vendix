import { Prisma } from '@prisma/client';
import { resolveLineUnits, roundMoney2 } from '../../taxes/utils/final-price.util';
import { resolveLineTotals } from '../../taxes/utils/tax-inclusive-math.util';
import { FullTaxRow } from '../../taxes/utils/product-tax-rows.util';
import { resolvePriceUnitScale } from '../../products/services/price-unit.util';

/**
 * Extraído de `TableSessionsService.addItems` (QUI-650) para que la cuenta
 * abierta y el editor de líneas de orden (`OrderItemChangesService`) calculen
 * precio y tax de catálogo con UNA sola definición.
 *
 * Las filas de impuesto (`FullTaxRow`) y su resolver por producto
 * (`resolveFullTaxRowsByProductId`) viven en `taxes/utils/product-tax-rows.util`,
 * compartidos también con las cuentas de estaciones de servicio.
 */

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
