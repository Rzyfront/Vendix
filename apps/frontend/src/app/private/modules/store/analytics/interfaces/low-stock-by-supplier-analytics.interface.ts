/**
 * Frontend mirror of `LowStockBySupplierAnalyticsEnvelope` (backend).
 *
 * MUST stay in sync with:
 *   apps/backend/src/domains/store/analytics/interfaces/low-stock-by-supplier-row.interface.ts
 *
 * Used by the analytics shell page (Phase H, FB-06). The page never
 * re-aggregates rows — it relies on the envelope produced by the backend.
 */
export interface LowStockBySupplierKpis {
  total_low_stock: number;
  total_out_of_stock: number;
  /** SUM(current_stock × cost_per_unit) over the rows. */
  total_value_at_risk: number;
  /**
   * Average of `days_without_sale` over rows where the value is not `null`.
   * `null` when no row has a recorded sale.
   */
  avg_days_without_sale: number | null;
  /** Count of rows with `supplier_id === null`. */
  products_without_supplier: number;
}

export interface LowStockBySupplierSupplierBucket {
  supplier_id: number | null;
  supplier_name: string;
  low_stock_count: number;
  out_of_stock_count: number;
  value_at_risk: number;
}

export interface LowStockBySupplierCategoryBucket {
  category_id: number | null;
  category_name: string;
  low_stock_count: number;
  out_of_stock_count: number;
}

export interface LowStockBySupplierTopCritical {
  product_id: number;
  product_name: string;
  sku: string | null;
  current_stock: number;
  min_threshold: number;
  status: 'low_stock' | 'out_of_stock';
  supplier_name: string | null;
  value_at_risk: number;
}

export interface LowStockBySupplierHistoryPoint {
  /** `YYYY-MM-DD` in store timezone. */
  date: string;
  low_stock_count: number;
  out_of_stock_count: number;
}

/**
 * Cobertura del `value_at_risk` — cuántos SKUs del reporte tienen
 * `current_stock × cost_per_unit` resuelto (auditable) y cuántos no.
 *
 * Espejo del helper `buildCostCoverage(total, sin_costo)` en el backend.
 * El frontend usa `coverage_ratio < 1` para mostrar "X / Y con costo
 * conocido" en la card de valor en riesgo y distinguir "valor bajo" de
 * "costo desconocido".
 */
export interface LowStockBySupplierCostCoverage {
  units_total: number;
  units_without_cost: number;
  coverage_ratio: number;
}

export interface LowStockBySupplierAnalyticsEnvelope {
  kpis: LowStockBySupplierKpis;
  by_supplier: LowStockBySupplierSupplierBucket[];
  by_category: LowStockBySupplierCategoryBucket[];
  /** Top 10 critical rows by `value_at_risk DESC`. */
  top_critical: LowStockBySupplierTopCritical[];
  /**
   * Cobertura del `value_at_risk`. Siempre presente — el frontend debe
   * leer `coverage_ratio` para diferenciar "valor bajo" de "costo
   * desconocido" en la card de valor en riesgo.
   */
  cost_coverage: LowStockBySupplierCostCoverage;
  /**
   * Optional 30-day series — only present when a daily stock snapshot
   * table exists (ADR-2). When the snapshot is absent, the field is
   * omitted from the response.
   */
  history_30d?: LowStockBySupplierHistoryPoint[];
}
