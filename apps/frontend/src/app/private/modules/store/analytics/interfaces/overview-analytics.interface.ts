export interface OverviewSummary {
  total_income: number;
  total_expenses: number;
  net_profit: number;
  breakeven_ratio: number;
  total_taxes: number;
  income_growth?: number;
  expenses_growth?: number;
  net_profit_growth?: number;
  taxes_growth?: number;
}

export interface OverviewTrend {
  period: string;
  sales: number;
  expenses: number;
  taxes: number;
  gross_profit: number;
  net_profit: number;
}

export interface OverviewAnalyticsQueryDto {
  date_range?: {
    start_date: string;
    end_date: string;
    preset?: string;
  };
  granularity?: string;
}
