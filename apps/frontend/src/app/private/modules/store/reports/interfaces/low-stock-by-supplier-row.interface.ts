/**
 * Frontend mirror of the backend `LowStockBySupplierRow` interface.
 *
 * MUST stay in sync with:
 *   apps/backend/src/domains/store/analytics/interfaces/low-stock-by-supplier-row.interface.ts
 *
 * Date fields are received as ISO strings (backend serialises `Date` to
 * `toISOString()` over the wire) and re-parsed to `Date` in the page
 * component for `DatePipe` rendering.
 */
export interface LowStockBySupplierRow {
  product_id: number;
  product_name: string;
  sku: string | null;

  current_stock: number;
  /** ISO `YYYY-MM-DD` from the backend `date-only` cell, or `null`. */
  previous_stock: number | null;
  previous_stock_source: 'snapshot' | 'estimated' | 'na';
  delta: number | null;

  min_threshold: number;
  status: 'low_stock' | 'out_of_stock';

  supplier_id: number | null;
  supplier_name: string | null;
  supplier_sku: string | null;

  /** ISO `YYYY-MM-DD` from the backend `date-only` cell, or `null`. */
  last_purchase_date: string | null;
  last_purchase_cost: number | null;
  last_purchase_po_number: string | null;

  /** Whole days since the last sale. `null` = never sold. */
  days_without_sale: number | null;
  units_per_package: number;
}
