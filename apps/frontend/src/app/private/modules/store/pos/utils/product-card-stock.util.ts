/** Fields of a POS catalog product that drive its availability label. */
export interface ProductCardStockInput {
  stock?: number | null;
  track_inventory?: boolean;
  effective_track_inventory?: boolean;
}

/**
 * Label for the "available" state of a POS product card (QUI-986): with
 * tracked inventory it shows how many units remain, so the cashier sees the
 * stock go down after each sale; without inventory control there is no
 * quantity to show. Quantities follow `formatSaleQuantity` (es-CO, up to 3
 * decimals for weight products).
 */
export function availableStockLabel(product: ProductCardStockInput): string {
  if (
    product.effective_track_inventory === false ||
    product.track_inventory === false
  ) {
    return 'Disponible';
  }
  const stock = Number(product.stock ?? 0);
  const text = Number.isInteger(stock)
    ? stock.toLocaleString('es-CO')
    : stock.toLocaleString('es-CO', { maximumFractionDigits: 3 });
  return `${text} disponibles`;
}
