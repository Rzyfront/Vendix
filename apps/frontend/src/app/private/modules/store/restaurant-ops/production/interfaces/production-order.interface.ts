/**
 * Restaurant Suite — Phase C.
 * Source of truth for the Production Orders / Sub-recipe batch stock domain
 * in the frontend.
 *
 * Mirrors the Prisma model `production_orders` and the controller exposed by
 * `apps/backend/src/domains/store/production/`.
 */
import type { InsufficientStockItem } from '../../../../../../core/utils/parse-api-error';

export type ProductionOrderStatus =
  | 'draft'
  | 'in_progress'
  /** Planta only: part of the planned quantity is already produced; the order stays running. */
  | 'partially_completed'
  | 'completed'
  | 'cancelled';

/** An order the cook is still working on: drives the timer, "Finalizar" and carry-over. */
export const isProductionRunning = (status: string): boolean =>
  status === 'in_progress' || status === 'partially_completed';

/**
 * A partially finished order only exists in Planta, whose detail knows what is
 * left to produce, the lot and the locations. The restaurant `complete`
 * endpoint rejects it, so "Finalizar" opens the Planta detail instead.
 */
export const finishesInPlanta = (status: string): boolean =>
  status === 'partially_completed';

export const PLANTA_ORDER_DETAIL_BASE = '/admin/manufacturing/orders';

export interface ProductionOrderProduct {
  id: number;
  name: string;
  image_url?: string | null;
  sku?: string | null;
  stock_unit?: string | null;
  is_batch_produced?: boolean;
}

export interface ProductionOrderRecipe {
  id: number;
  yield_quantity: number | string;
  yield_unit: string;
  waste_percent: number | string;
  preparation_notes?: string | null;
}

export type ProductionOrderSource = 'manual' | 'order';

/** Compact link from a production order (or a sale line) to its production order. */
export interface ProductionOrderRef {
  id: number;
  order_number: string | null;
  status: ProductionOrderStatus | string;
}

export interface ProductionOrderSaleOrder {
  id: number;
  order_number: string;
  state: string;
  customer_name: string | null;
  /** ISO UTC; promised time of the sale. */
  due_at: string | null;
}

export interface ProductionOrderComponent {
  name: string;
  quantity: number | string;
  unit?: string | null;
  image_url?: string | null;
}

export interface ProductionOrderBaseRecipe {
  components: ProductionOrderComponent[];
}

/**
 * One supply line of an order: planned vs consumed, with the cost captured when
 * the order was finished. Same shape as Planta's `ManufacturingOrderLine`.
 */
export interface ProductionOrderLine {
  id: number;
  component_product_id: number;
  component_variant_id?: number | null;
  uom_id?: number | null;
  planned_qty: number | string;
  consumed_qty?: number | string | null;
  unit_cost?: number | string | null;
  total_cost?: number | string | null;
  component_product?: {
    id: number;
    name: string;
    sku?: string | null;
    stock_unit?: string | null;
  } | null;
}

export interface ProductionOrderLineAddon {
  group_name: string;
  option_name: string;
  note: string | null;
  image_url: string | null;
  recipe: { components: ProductionOrderComponent[] } | null;
}

export interface ProductionOrderSaleLine {
  order_item_id: number;
  quantity: number | string;
  notes: string | null;
  addons: ProductionOrderLineAddon[];
}

export interface ProductionOrder {
  id: number;
  /** Set by the production sequence; null on legacy rows. */
  order_number?: string | null;
  store_id: number;
  product_id: number;
  recipe_id: number;
  planned_qty: number | string;
  produced_qty?: number | string | null;
  status: ProductionOrderStatus;
  produced_at?: string | Date | null;
  started_at?: string | Date | null;
  /** QUI-1002: per-order estimated minutes override. */
  estimated_minutes?: number | null;
  created_at: string | Date;
  updated_at: string | Date;

  // Populated by GET list/detail.
  product?: ProductionOrderProduct;
  /** S19: sold variant this order makes (null for base products and manual orders). */
  product_variant?: { id: number; name: string } | null;
  /** S21: detail only; true when "Volver a iniciar" applies (cancelled order, active sale, live line). */
  can_restart?: boolean;
  recipe?: ProductionOrderRecipe;

  // T13 (QUI-995): link with the sale. `source` is 'manual' for orders
  // created by hand (order_id NULL) and 'order' for those born from a sale.
  source?: ProductionOrderSource | null;
  order_id?: number | null;
  /** Only in the list response. */
  sale_order_number?: string | null;
  // Only in the detail response.
  sale_order?: ProductionOrderSaleOrder | null;
  base_recipe?: ProductionOrderBaseRecipe | null;
  order_lines?: ProductionOrderSaleLine[];
  /** Detail only: supplies planned vs consumed (empty for orders finished before the breakdown existed). */
  lines?: ProductionOrderLine[];

  /**
   * Presente en la respuesta de `POST .../complete` cuando
   * `allow_ingredient_overuse` dejó pasar el consumo con insumos
   * faltantes: no bloqueó, pero el insumo quedó en negativo. Plan
   * no-overselling-stock-guard-plan.md paso 9 — la lista se muestra como
   * toast de advertencia.
   */
  stock_warnings?: InsufficientStockItem[];
}

export interface CreateProductionOrderDto {
  product_id: number;
  recipe_id: number;
  planned_qty: number;
  notes?: string;
}

export interface UpdateProductionOrderDto {
  notes?: string;
}

export interface CompleteProductionOrderDto {
  produced_qty: number;
  waste_percent_override?: number;
  notes?: string;
}

export interface ProductionOrderQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: ProductionOrderStatus;
  product_id?: number;
  recipe_id?: number;
  /** T13: only the production orders of one sale. */
  order_id?: number;
  sort_by?: 'created_at' | 'produced_at' | 'planned_qty' | 'produced_qty' | 'status';
  sort_order?: 'asc' | 'desc';
}

export interface ProductionOrderStats {
  draft: number;
  in_progress: number;
  completed: number;
  cancelled: number;
  total: number;
  produced_today: number;
  produced_week: number;
  produced_month: number;
}

/**
 * Compact shape used to populate the product selector on the production
 * form. Source = GET /store/products filtered to `is_batch_produced=true`.
 */
export interface ProductionProductOption {
  id: number;
  name: string;
  sku?: string | null;
  stock_unit?: string | null;
  is_batch_produced?: boolean;
  product_type?: 'physical' | 'service' | 'prepared';
}

/**
 * T14 (QUI-996): "Lista de producción" of one day. One card per sale or per
 * manual production order; the card status is derived server-side.
 */
export type ProductionDayCardStatus = 'waiting' | 'in_progress' | 'completed';

export interface ProductionDayOrder {
  id: number;
  order_number: string;
  /** `released` only appears on manufacturing orders. */
  status: ProductionOrderStatus | 'released';
  source: string | null;
  product_id: number;
  product_name: string;
  /** S19: variant name when the order makes a variant (null otherwise). */
  variant_name?: string | null;
  planned_qty: number;
  produced_qty: number | null;
  started_at: string | null;
  produced_at: string | null;
  due_date: string | null;
  created_at: string;
  /** QUI-1002: per-order override of the estimated minutes (null = none). */
  estimated_minutes: number | null;
  /** `estimated_minutes ?? product preparation time`; null = count up. */
  effective_estimated_minutes: number | null;
}

export interface ProductionDayCard {
  /** 'sale-<order_id>' | 'po-<id>' */
  key: string;
  kind: 'sale' | 'manual';
  order_id: number | null;
  sale_order_number: string | null;
  customer_name: string | null;
  /** ISO; the delivery / planned time of the card. */
  due_at: string | null;
  status: ProductionDayCardStatus;
  /** In-progress order carried over from a previous day (multi-day). */
  carried_over: boolean;
  production_orders: ProductionDayOrder[];
}

export interface ProductionDayResponse {
  /** YYYY-MM-DD in the store timezone. */
  date: string;
  timezone: string;
  /** Counts the WHOLE day, not the page of `cards`. */
  summary: { waiting: number; in_progress: number; completed: number };
  /** One page of cards; a sale card may come back on a later page (same `key`). */
  cards: ProductionDayCard[];
  /** Opaque cursor of the next page; `null`/absent on the last page. */
  next_cursor?: string | null;
  /** ISO server time at response; feeds the stopwatch clock offset. */
  server_now?: string;
}

/** QUI-1002: result of moving every order of a sale card (start / complete). */
export interface ProductionSaleMoveResult {
  moved: number[];
  skipped: number[];
  failed: { id: number; message: string }[];
}

/** QUI-1002: message of `GET /store/production-orders/stream` (SSE). */
export interface ProductionStreamEvent {
  type: 'production_order.updated';
  store_id: number;
  id: number;
  order_id: number | null;
  status: string;
  started_at: string | null;
  produced_at: string | null;
  estimated_minutes: number | null;
}

/** One supply of `GET .../day/supplies`: quantities only, never cost. */
export interface ProductionDaySupply {
  product_id: number;
  name: string;
  sku: string | null;
  unit: string | null;
  planned: number;
  consumed: number;
  /** Σ max(planned - consumed, 0) of the orders not finished yet. */
  pending: number;
  /** Σ (consumed - planned) of the finished orders. */
  difference: number;
}

/** Response of `GET store/production-orders/day/supplies` and the Planta twin. */
export interface ProductionDaySupplies {
  /** YYYY-MM-DD in the store timezone. */
  date: string;
  timezone: string;
  orders_total: number;
  orders_completed: number;
  /** Finished orders without lines (finished before the breakdown existed). */
  orders_without_breakdown: number;
  supplies: ProductionDaySupply[];
}
