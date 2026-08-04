/**
 * How much of the sold volume has a KNOWN unit cost. A COGS built on missing
 * cost snapshots reads as a 100 % margin, which is indistinguishable from a real
 * one — so the profit figures must be shown together with this coverage.
 */
export interface CostCoverage {
  units_total: number;
  units_without_cost: number;
  /** Fraction of units WITH a known cost, 0..1 (1 = fully costed). */
  coverage_ratio: number;
}

export interface OverviewSummary {
  /** Operating revenue: subtotal − discounts + freight. Excludes VAT. */
  total_income: number;
  /** Recognized expenses (approved + paid). */
  total_expenses: number;
  /** Cost of goods sold for the period. */
  cost_of_goods_sold: number;
  /** total_income − cost_of_goods_sold. */
  gross_profit: number;
  gross_margin: number;
  /** gross_profit − total_expenses. Always ≤ gross_profit. */
  net_profit: number;
  net_margin: number;
  /** (cost_of_goods_sold + total_expenses) / total_income × 100. */
  breakeven_ratio: number;
  total_taxes: number;
  /**
   * `null` = the previous period had no base to compare against. Render it as
   * "sin base de comparación", never as "0 %".
   */
  income_growth: number | null;
  expenses_growth: number | null;
  net_profit_growth: number | null;
  taxes_growth: number | null;
  cost_coverage: CostCoverage;
}

export interface OverviewTrend {
  period: string;
  /** Operating revenue of the period (VAT excluded). */
  sales: number;
  expenses: number;
  taxes: number;
  cost_of_goods: number;
  gross_profit: number;
  net_profit: number;
  units_without_cost: number;
}

export interface OverviewAnalyticsQueryDto {
  date_range?: {
    start_date: string;
    end_date: string;
    preset?: string;
  };
  granularity?: string;
}
