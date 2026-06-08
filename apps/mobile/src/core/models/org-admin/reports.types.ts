import type { ISODateString, MoneyAmount } from './common.types';

export interface SalesReport {
  period: { start: ISODateString; end: ISODateString };
  total_sales: MoneyAmount;
  total_orders: number;
  average_ticket: MoneyAmount;
  by_channel: Array<{ channel: string; total: MoneyAmount; orders: number }>;
  by_store: Array<{ store_id: string; store_name: string; total: MoneyAmount; orders: number }>;
  by_day: Array<{ date: ISODateString; total: MoneyAmount; orders: number }>;
  top_products: Array<{ product_id: string; product_name: string; quantity: number; total: MoneyAmount }>;
  trend: 'up' | 'down' | 'flat';
  change_percent: number;
}

export interface InventoryReport {
  period: { start: ISODateString; end: ISODateString };
  total_products: number;
  total_value: MoneyAmount;
  total_quantity: number;
  by_location: Array<{ location_id: string; location_name: string; quantity: number; value: MoneyAmount }>;
  by_category: Array<{ category_id: string; category_name: string; quantity: number; value: MoneyAmount }>;
  low_stock: Array<{ product_id: string; product_name: string; current: number; min: number }>;
  expiring_batches: number;
  movements_summary: {
    total_in: number;
    total_out: number;
    total_adjustments: number;
  };
}

export interface FinancialReport {
  period: { start: ISODateString; end: ISODateString };
  revenue: MoneyAmount;
  cogs: MoneyAmount;
  gross_profit: MoneyAmount;
  expenses: MoneyAmount;
  operating_income: MoneyAmount;
  net_income: MoneyAmount;
  income_statement: Array<{ account: string; amount: MoneyAmount }>;
  balance_sheet: {
    assets: MoneyAmount;
    liabilities: MoneyAmount;
    equity: MoneyAmount;
  };
  trial_balance: Array<{ account_code: string; account_name: string; debit: MoneyAmount; credit: MoneyAmount }>;
  general_ledger: Array<{ date: ISODateString; account: string; description: string; debit: MoneyAmount; credit: MoneyAmount }>;
}

export interface ReportFilter {
  start_date: ISODateString;
  end_date: ISODateString;
  store_ids?: string[];
  channels?: string[];
  granularity?: 'day' | 'week' | 'month';
}
