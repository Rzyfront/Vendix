/**
 * Tipos mínimos del módulo "Pedidos programados". Reflejan el contrato de la
 * API (`/store/scheduled-orders/*`) descrito en el documento de feature.
 */

export type ScheduledOrderStatus =
  | 'scheduled'
  | 'in_production'
  | 'ready'
  | 'delivered'
  | 'no_show'
  | 'cancelled';

export type AgendaViewMode = 'week' | 'day';

export const STATUS_LABELS: Record<ScheduledOrderStatus, string> = {
  scheduled: 'Programada',
  in_production: 'En producción',
  ready: 'Lista',
  delivered: 'Entregada',
  no_show: 'No recogida',
  cancelled: 'Cancelada',
};

export const STATUS_ORDER: ScheduledOrderStatus[] = [
  'scheduled',
  'in_production',
  'ready',
  'delivered',
  'no_show',
  'cancelled',
];

/** Transiciones válidas (espejo de `FULFILLMENT_TRANSITIONS` del backend). */
export const STATUS_TRANSITIONS: Record<ScheduledOrderStatus, ScheduledOrderStatus[]> = {
  scheduled: ['in_production', 'cancelled'],
  in_production: ['ready', 'cancelled'],
  ready: ['delivered', 'no_show', 'cancelled'],
  delivered: [],
  no_show: [],
  cancelled: [],
};

/** Estados desde los que aún se puede reprogramar (arrastrar). */
export const RESCHEDULABLE_STATUSES: ScheduledOrderStatus[] = [
  'scheduled',
  'in_production',
  'ready',
];

export interface FulfillmentSlot {
  /** ISO UTC */
  start: string;
  end: string;
  /** Hora local de la tienda, "HH:mm" */
  local_start: string;
  local_end: string;
  capacity: number;
  taken: number;
  available: boolean;
  blocked_reason: 'lead_time' | 'too_far' | 'slot_full' | 'day_full' | null;
}

export interface FulfillmentDay {
  /** YYYY-MM-DD en la zona de la tienda */
  date: string;
  day_of_week: number;
  blocked_reason: 'day_blocked' | null;
  exception_reason: string | null;
  day_capacity: number | null;
  day_taken: number;
  slots: FulfillmentSlot[];
}

export interface ScheduledOrderOptionLine {
  group_name: string;
  option_name: string;
  quantity: number | string;
  uom?: string | null;
  scope?: 'per_unit' | 'per_line';
}

export interface ScheduledOrderItem {
  id: number;
  product_name: string;
  variant_attributes?: string | Record<string, unknown> | null;
  quantity: number | string;
  notes?: string | null;
  order_item_options?: ScheduledOrderOptionLine[];
}

export interface ScheduledOrderCustomer {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface ScheduledOrder {
  id: number;
  order_id: number;
  /** ISO UTC */
  scheduled_start: string;
  scheduled_end: string;
  fulfillment_type: 'pickup' | 'delivery';
  status: ScheduledOrderStatus;
  produced_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  order: {
    id: number;
    order_number: string;
    grand_total: number | string;
    state: string;
    users: ScheduledOrderCustomer | null;
    order_items: ScheduledOrderItem[];
  };
}

export interface ScheduledOrderChange {
  change_type: 'created' | 'status' | 'reschedule';
  from_status: ScheduledOrderStatus | null;
  to_status: ScheduledOrderStatus | null;
  from_start: string | null;
  to_start: string | null;
  created_at: string;
  changed_by: { first_name?: string | null; last_name?: string | null } | null;
}

export interface ScheduledOrderDetail extends ScheduledOrder {
  changes: ScheduledOrderChange[];
}

export interface ProductionOption {
  group_name: string;
  option_name: string;
  quantity: number | string;
  uom?: string | null;
}

export interface ProductionOrderItem {
  product_name: string;
  variant_attributes?: string | Record<string, unknown> | null;
  quantity: number | string;
  options: ProductionOption[];
}

export interface ProductionOrder {
  schedule_id: number;
  order_id: number;
  order_number: string;
  status: ScheduledOrderStatus;
  customer_name: string | null;
  items: ProductionOrderItem[];
}

export interface ProductionSlot {
  start: string;
  end: string;
  local_start: string;
  local_end: string;
  orders: ProductionOrder[];
}

export interface ProductionIngredient {
  product_id: number;
  name: string;
  quantity: number | string;
  uom: string | null;
}

export interface ProductionList {
  date: string;
  slots: ProductionSlot[];
  ingredients: ProductionIngredient[];
}

export interface AgendaPreference {
  view: AgendaViewMode;
  status: ScheduledOrderStatus | 'all';
}

/** Describe un `variant_attributes` (texto u objeto) como texto legible. */
export function describeVariant(
  value: string | Record<string, unknown> | null | undefined,
): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return Object.values(value)
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map((v) => String(v))
    .join(' / ');
}

export function customerName(u: ScheduledOrderCustomer | null | undefined): string {
  if (!u) return 'Cliente general';
  return [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Cliente general';
}

/** Color de acento por estado (tokens del tema, un color distinto por estado). */
export const STATUS_COLORS: Record<ScheduledOrderStatus, string> = {
  scheduled: 'var(--color-info, #3b82f6)',
  in_production: 'var(--color-warning, #f59e0b)',
  ready: 'var(--color-success, #16a34a)',
  delivered: 'var(--color-primary, #7ed7a5)',
  no_show: 'var(--color-error, #dc2626)',
  cancelled: 'var(--color-text-muted, #94a3b8)',
};
