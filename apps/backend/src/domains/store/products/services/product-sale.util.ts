import { ErrorCodes, VendixHttpException } from 'src/common/errors';

type Money = number | string | { toString(): string } | null | undefined;

export interface ProductSaleState {
  is_on_sale?: boolean | null;
  sale_price?: Money;
  base_price?: Money;
}

const SALE_FIELDS = ['is_on_sale', 'sale_price', 'base_price'] as const;

/**
 * Oferta del producto: con `is_on_sale` el precio de oferta debe ser > 0 y
 * menor que el precio base (misma convención de IVA). Solo se valida cuando
 * la petición toca precio u oferta (`touched`), para no bloquear un guardado
 * ajeno sobre un producto que ya traía datos inválidos.
 */
export function assertProductSaleValid(
  next: ProductSaleState,
  touched: ProductSaleState & object,
): void {
  if (!SALE_FIELDS.some((field) => (touched as ProductSaleState)[field] !== undefined)) return;
  if (next.is_on_sale !== true) return;

  const sale = Number(next.sale_price?.toString() ?? 0);
  const base = Number(next.base_price?.toString() ?? 0);
  if (Number.isFinite(sale) && sale > 0 && sale < base) return;

  throw new VendixHttpException(
    ErrorCodes.PROD_SALE_PRICE_001,
    `El precio de oferta (${sale || 0}) debe ser mayor que 0 y menor que el precio base (${base || 0}).`,
  );
}
