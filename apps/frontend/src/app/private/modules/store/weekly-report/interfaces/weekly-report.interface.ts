/**
 * Contrato espejo del backend (apps/backend/src/domains/store/weekly-report/types.ts).
 * Mantener sincronizado si se agregan campos al snapshot persistido.
 */

export type WeeklyTier = 'ZERO' | 'BELOW' | 'ABOVE' | 'STELLAR';

export type WeeklyTipKey =
  | 'record_every_sale'
  | 'register_purchases'
  | 'invite_to_online_store'
  | 'evaluate_ecommerce'
  | 'low_online_channel'
  | 'no_inventory_movements'
  | 'keep_momentum';

export interface WeeklyMetricSet {
  total_revenue: number;
  total_orders: number;
  average_ticket: number;
  total_units_sold: number;
  new_customers: number;
  top_product: {
    product_id: number;
    name: string;
    units: number;
    revenue: number;
  } | null;
  best_day: {
    date: string;
    revenue: number;
    orders: number;
  } | null;
  channel_breakdown: Array<{
    channel: string;
    display_name: string;
    revenue: number;
    percentage: number;
  }>;
  inventory: {
    purchase_orders: number;
    total_spent: number;
    items_received: number;
  };
}

export interface WeeklyRollingAvg {
  revenue: number;
  orders: number;
  average_ticket: number;
  weeks_sampled: number;
}

export interface WeeklyTip {
  key: WeeklyTipKey;
  title: string;
  body: string;
  cta: {
    label: string;
    route: string;
  } | null;
}

export type WeeklySlideKind =
  | 'cover'
  | 'sales'
  | 'orders'
  | 'top_product'
  | 'customers'
  | 'channels'
  | 'inventory'
  | 'tips'
  | 'closing';

export interface WeeklySlide {
  id: string;
  kind: WeeklySlideKind;
  title: string;
  subtitle?: string;
  payload: Record<string, any>;
}

export interface WeeklyReportSnapshot {
  id: number;
  store_id: number;
  week_start_date: string;
  week_end_date: string;
  tier: WeeklyTier;
  metrics: WeeklyMetricSet;
  slides: WeeklySlide[];
  tips: WeeklyTip[];
  rolling_avg: WeeklyRollingAvg | null;
  generated_at: string;
  viewed_at: string | null;
}

export interface WeeklyReportResponse {
  success: boolean;
  message?: string;
  data: WeeklyReportSnapshot | null;
}
