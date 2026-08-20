/**
 * One row of the "Stock Bajo por Proveedor" report — both for the in-app
 * paginated view and for the XLSX export.
 *
 * RAW values only — numbers are plain numbers, dates are native `Date`,
 * and absent related names are `null` (NOT `'-'` / `'Desconocido'`).
 * The emission phase (ReportBuilder) owns headers, currency/date
 * formatting, and presentation fallbacks.
 *
 * Contract of record for FB-01 (rows endpoint) and FB-02 (XLSX export).
 * Changing a field here is a contract break — update both the backend
 * service that emits it AND the frontend interface that consumes it
 * (apps/frontend/.../reports/interfaces/low-stock-by-supplier-row.interface.ts).
 */
export interface LowStockBySupplierRow {
  /** `products.id` — primary key of the product. */
  product_id: number;

  /** `products.name` — display name. */
  product_name: string;

  /** `products.sku` — SKU; `null` for products without SKU. */
  sku: string | null;

  /**
   * Current stock, aggregated across all in-scope locations of the active
   * store (excludes central warehouse). Computed as
   * `SUM(stock_levels.quantity_available)` over locations matching
   * `inventory_locations.store_id = context.store_id AND
   *  inventory_locations.is_central_warehouse = false`.
   */
  current_stock: number;

  /**
   * Estimated stock 24h ago, derived from `inventory_movements` when no daily
   * snapshot exists (ADR-2). `null` when the estimate cannot be computed
   * (no movements recorded, or movements predating the window).
   */
  previous_stock: number | null;

  /**
   * Marker for the source of `previous_stock`. Values:
   *  - `'snapshot'`  — read from a daily snapshot table (preferred, future-proof)
   *  - `'estimated'` — derived from `inventory_movements` aggregation
   *  - `'na'`        — not available (no movements or out-of-window)
   */
  previous_stock_source: 'snapshot' | 'estimated' | 'na';

  /** `current_stock − previous_stock`. `null` when `previous_stock_source === 'na'`. */
  delta: number | null;

  /**
   * Effective low-stock threshold for this product. Resolved by
   * `resolveProductLowStockThreshold(settings, product)`:
   * `reorder_point > min_stock_level > store_settings.inventory.low_stock_threshold`.
   */
  min_threshold: number;

  /**
   * Stock status of the row.
   *  - `'low_stock'`    — `0 < current_stock ≤ min_threshold`
   *  - `'out_of_stock'` — `current_stock === 0`
   */
  status: 'low_stock' | 'out_of_stock';

  /**
   * Preferred supplier of the product, derived from `supplier_products`
   * with `is_preferred = true` and `suppliers.state = 'active'`. `null` when
   * the product has no preferred supplier (ADR-3: tie-break by
   * `cost_per_unit ASC NULLS LAST`, fallback to `null`).
   */
  supplier_id: number | null;

  /**
   * Display name of the preferred supplier. `'Sin proveedor asignado'`
   * when `supplier_id === null`.
   */
  supplier_name: string | null;

  /** `supplier_products.supplier_sku` — supplier-side SKU; `null` if absent. */
  supplier_sku: string | null;

  /**
   * Date of the last purchase order (in `PURCHASE_COMMITTED_STATES` =
   * `approved | partial | received`) for this product. `null` when no
   * committed purchase exists.
   */
  last_purchase_date: Date | null;

  /**
   * Net unit cost (post-discount) of the last purchase line, in store
   * currency. Sourced from `purchase_order_items.unit_price_net`. `null`
   * when no committed purchase exists.
   */
  last_purchase_cost: number | null;

  /**
   * Purchase-order number (`purchase_orders.order_number` or `id` fallback)
   * for `last_purchase_date`. `null` when no committed purchase exists.
   */
  last_purchase_po_number: string | null;

  /**
   * Days since the last sale of this product (in `COMPLETED_SALE_STATES` =
   * `delivered | finished`). `null` when the product has never sold
   * (interpreted as `∞` — no rotation yet).
   */
  days_without_sale: number | null;

  /**
   * Units per package at purchase (`products.purchase_to_stock_factor`).
   * `1` when the product does not use packaging. Useful for the buyer to
   * translate the deficit into order units.
   */
  units_per_package: number;
}

/**
 * Envelope returned by the analytics endpoint (Phase H, FB-06).
 *
 * All fields are computed in a single backend pass and sent pre-aggregated;
 * the frontend MUST NOT re-aggregate them. Date keys inside `history_30d`
 * are `YYYY-MM-DD` strings in the store timezone.
 */
export interface LowStockBySupplierAnalyticsEnvelope {
  kpis: {
    total_low_stock: number;
    total_out_of_stock: number;
    /** Sum of `current_stock × cost_per_unit` over the rows. */
    total_value_at_risk: number;
    /**
     * Average of `days_without_sale` over rows where the value is not `null`.
     * `null` when no row has a recorded sale.
     */
    avg_days_without_sale: number | null;
    /** Count of rows with `supplier_id === null`. */
    products_without_supplier: number;
  };
  by_supplier: Array<{
    supplier_id: number | null;
    supplier_name: string;
    low_stock_count: number;
    out_of_stock_count: number;
    value_at_risk: number;
  }>;
  by_category: Array<{
    category_id: number | null;
    category_name: string;
    low_stock_count: number;
    out_of_stock_count: number;
  }>;
  /** Top 10 critical rows by `value_at_risk DESC`. */
  top_critical: Array<{
    product_id: number;
    product_name: string;
    sku: string | null;
    current_stock: number;
    min_threshold: number;
    status: 'low_stock' | 'out_of_stock';
    supplier_name: string | null;
    value_at_risk: number;
  }>;
  /**
   * Cobertura del `value_at_risk` — cuántos SKUs del reporte tienen
   * `current_stock × cost_per_unit` resuelto (auditable) y cuántos no.
   *
   * Espejo de `CostCoverage` en `analytics-metrics.contract.ts`; reusa el
   * mismo helper `buildCostCoverage(total, sin_costo)` para que el card de
   * valor en riesgo pinte "X / Y con costo conocido" de forma consistente
   * con la valuación de inventario y otros reportes de analytics. El campo
   * siempre viaja: el frontend puede leer `coverage_ratio` para diferenciar
   * "valor bajo" de "costo desconocido".
   */
  cost_coverage: {
    units_total: number;
    units_without_cost: number;
    coverage_ratio: number;
  };
  /**
   * Optional 30-day series — only present when a daily stock snapshot
   * table exists (ADR-2). When the snapshot is absent, the field is
   * omitted from the response.
   */
  history_30d?: Array<{
    /** `YYYY-MM-DD` in store timezone. */
    date: string;
    low_stock_count: number;
    out_of_stock_count: number;
  }>;
}
