/**
 * UoM display helper (Fase UoM).
 *
 * The inventory core stores everything in the minimum stock unit
 * (e.g. ml, g, unit). For restaurant ingredients with a purchase→stock
 * factor, the user wants to see "9 sellados + 1 abierto (680 ml)" instead
 * of the raw 9680 ml. This helper computes the sealed/open split from a
 * row that already includes the related `products` shape.
 *
 * IMPORTANT: the total in minimum stock units (`quantity_on_hand`) is
 * always the source of truth — never persist the split. If the operator
 * changes the factor mid-life, the split is recomputed on read and may
 * differ from the historical view; the total stays correct.
 */

export type StockRowWithProduct = {
  quantity_on_hand?: number | null;
  products?: {
    is_ingredient?: boolean;
    purchase_to_stock_factor?: number | null;
    stock_unit?: string | null;
  } | null;
};

/**
 * Presentation-only view of an ingredient stock row (Modelo B).
 *
 * - `sealed_units`   → whole sealed containers shown as the headline figure.
 * - `open_remaining` → volume left in the currently open container.
 * - `total_volume`   → the canonical `quantity_on_hand` (minimum stock unit).
 * - `capacity`       → volume per sealed container (purchase_to_stock_factor).
 * - `stock_uom_code` → label for the minimum unit (e.g. "ml", "g").
 *
 * All fields are `null` for non-ingredients (retail stays untouched). The
 * canonical total in minimum units is never mutated — only surfaced.
 */
export type UoMSplit = {
  sealed_units: number | null;
  open_remaining: number | null;
  total_volume: number | null;
  capacity: number | null;
  stock_uom_code: string | null;
};

const EMPTY_SPLIT: UoMSplit = {
  sealed_units: null,
  open_remaining: null,
  total_volume: null,
  capacity: null,
  stock_uom_code: null,
};

export function deriveUoMSplit(row: StockRowWithProduct): UoMSplit {
  const product = row.products;
  if (!product?.is_ingredient) {
    return EMPTY_SPLIT;
  }
  const factor = Number(product.purchase_to_stock_factor ?? 0);
  if (!Number.isFinite(factor) || factor <= 0) {
    return EMPTY_SPLIT;
  }
  const code = product.stock_unit ?? null;
  const qty = Number(row.quantity_on_hand ?? 0);
  if (!Number.isFinite(qty) || qty < 0) {
    return {
      sealed_units: 0,
      open_remaining: 0,
      total_volume: 0,
      capacity: factor,
      stock_uom_code: code,
    };
  }
  return {
    sealed_units: Math.floor(qty / factor),
    open_remaining: qty % factor,
    total_volume: qty,
    capacity: factor,
    stock_uom_code: code,
  };
}
