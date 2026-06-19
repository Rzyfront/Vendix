/**
 * Tipos y contratos del reporte semanal "Tu Semana en Vendix".
 *
 * Estos tipos se exponen al frontend (vía JSON) y NO deben depender
 * de Prisma ni de lógica de servicio para mantener el contrato
 * estable y serializable.
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
    date: string; // YYYY-MM-DD (UTC)
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

export interface WeeklySlide {
  id: string;
  kind:
    | 'cover'
    | 'sales'
    | 'orders'
    | 'top_product'
    | 'customers'
    | 'channels'
    | 'inventory'
    | 'tips'
    | 'closing';
  title: string;
  subtitle?: string;
  payload: Record<string, any>;
}

export interface WeeklyReportSnapshot {
  id: number;
  store_id: number;
  week_start_date: string; // YYYY-MM-DD
  week_end_date: string; // YYYY-MM-DD
  tier: WeeklyTier;
  metrics: WeeklyMetricSet;
  slides: WeeklySlide[];
  tips: WeeklyTip[];
  rolling_avg: WeeklyRollingAvg | null;
  generated_at: string; // ISO
  viewed_at: string | null; // ISO | null
}

export interface WeeklyToneCopy {
  cover_emoji: string;
  cover_title: string;
  cover_subtitle: string;
  body_voice: 'sad' | 'neutral' | 'warm' | 'celebratory';
}

export const TIER_TONE: Record<WeeklyTier, WeeklyToneCopy> = {
  ZERO: {
    cover_emoji: '🌱',
    cover_title: 'Una semana tranquila',
    cover_subtitle: 'Cada tienda empieza en algún lado. Te contamos qué pasó.',
    body_voice: 'sad',
  },
  BELOW: {
    cover_emoji: '💪',
    cover_title: 'Vas en camino',
    cover_subtitle: 'Hay datos importantes que ya puedes aprovechar.',
    body_voice: 'neutral',
  },
  ABOVE: {
    cover_emoji: '🚀',
    cover_title: '¡Buena semana!',
    cover_subtitle: 'Superaste tu ritmo. Mira los detalles.',
    body_voice: 'warm',
  },
  STELLAR: {
    cover_emoji: '🏆',
    cover_title: '¡Semana increíble!',
    cover_subtitle: 'Rompiste tu récord. Esto es lo que lograste.',
    body_voice: 'celebratory',
  },
};
