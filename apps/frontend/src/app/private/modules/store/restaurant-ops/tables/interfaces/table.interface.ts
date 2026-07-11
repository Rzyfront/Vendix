/**
 * Restaurant Suite — Phase E.
 * Source of truth for the Tables / Table Sessions / Split Order domain
 * in the frontend.
 *
 * Mirrors the Prisma models `tables` and `table_sessions` plus the DTO
 * contracts exposed by `apps/backend/src/domains/store/tables/`.
 */

export type TableStatus = 'available' | 'occupied' | 'reserved' | 'cleaning';

export interface Table {
  id: number;
  store_id: number;
  name: string;
  zone: string | null;
  capacity: number | null;
  status: TableStatus;
  pos_x: number | null;
  pos_y: number | null;
  created_at: string | Date;
  updated_at: string | Date;
  active_session?: TableSessionSummary | null;
  /**
   * Populated by GET /store/tables/floor-map. Mirrors `status` unless
   * the table has an open session, in which case it is forced to
   * 'occupied'.
   */
  effective_status?: TableStatus;
  /**
   * Reservas pendientes/confirmadas asociadas a esta mesa (Phase 5
   * alignment). Permite al operador ver y sentar al cliente desde
   * el floor map.
   */
  pending_bookings?: PendingBookingSummary[];
  /**
   * Token público opaco usado para construir la URL de carta-por-mesa
   * (`${ecommerceUrl}/?mesa=${public_token}`). Lo genera el backend al
   * crear la mesa (uuidv4) y lo backfill-ea en `GET /store/tables/:id/qr`
   * si la mesa es previa a la migración. Opcional en el listado porque
   * el frontend no lo consume directamente — el endpoint QR lo devuelve
   * embebido en `public_url`.
   */
  public_token?: string;
}

/**
 * Respuesta de `GET /store/tables/:id/qr`. El backend genera un PNG
 * data URL (base64) listo para `<img [src]>` y la URL pública de la
 * carta de la mesa.
 */
export interface TableQrResponse {
  public_url: string;
  qr_data_url: string;
}

export interface PendingBookingSummary {
  id: number;
  booking_number: string;
  date: string | Date;
  start_time: string;
  end_time: string;
  status: string;
  customer: {
    id: number;
    first_name: string;
    last_name: string;
    phone?: string | null;
  } | null;
  product: { id: number; name: string } | null;
}

export interface TableSessionSummary {
  id: number;
  order_id: number;
  opened_by: number;
  opened_at: string | Date;
  closed_at: string | Date | null;
  guest_count: number | null;
}

export interface TableSession {
  id: number;
  store_id: number;
  table_id: number;
  order_id: number;
  opened_by: number;
  opened_at: string | Date;
  closed_at: string | Date | null;
  guest_count: number | null;
  order?: TableSessionOrder;
  table?: {
    id: number;
    name: string;
    zone: string | null;
    status: string;
  };
}

export interface TableSessionOrder {
  id: number;
  state: string;
  grand_total: number | string;
  subtotal_amount: number | string;
  tax_amount: number | string;
  discount_amount: number | string;
  /**
   * Customer assigned to the order, or `null` when the table is
   * anonymous. Populated by the enriched `GET /store/table-sessions/:id`
   * contract (no "Cliente General" sentinel — true anonymous is `null`).
   */
  customer?: TableSessionCustomerRef | null;
  order_items: TableSessionOrderItem[];
}

export interface TableSessionCustomerRef {
  id: number;
  first_name: string;
  last_name: string;
}

export interface TableSessionOrderItem {
  id: number;
  product_id: number | null;
  product_name: string;
  quantity: number;
  unit_price: number | string;
  total_price: number | string;
  inventory_consumed_at_fire: boolean;
  /**
   * Snapshot of `products.product_type` taken at order creation by the
   * backend (see `table-sessions.service.ts:addItems`). The table
   * session UI uses this to gate the kitchen control: only items with
   * `item_type === 'prepared'` participate in the fire-to-kitchen flow.
   * Null when the backend projection is older (legacy snapshots) — the
   * UI falls back to `false` (non-dish).
   */
  item_type?: string | null;
  /**
   * Kitchen-ticket items linked to this order item, ordered DESC by id
   * (most recent first). Empty/undefined when the item was never fired.
   * Used to derive the per-dish kitchen-state badge — see
   * `kitchenStateFor` on the session page.
   */
  kitchen_ticket_items?: KitchenTicketItemRef[];
}

/**
 * Minimal projection of a `kitchen_ticket_items` row carried in the
 * enriched table-session contract. Mirrors the backend `findOne`
 * include for `GET /store/table-sessions/:id`.
 */
export interface KitchenTicketItemRef {
  id: number;
  status: KitchenTicketItemRefStatus;
  kitchen_ticket_id: number;
  kitchen_ticket?: {
    id: number;
    status: string;
    daily_number: number | null;
    fired_at: string | Date;
  };
}

export type KitchenTicketItemRefStatus =
  | 'pending'
  | 'in_preparation'
  | 'ready'
  | 'delivered'
  | 'cancelled';

export interface CreateTableDto {
  name: string;
  zone?: string;
  capacity?: number;
  status?: TableStatus;
  pos_x?: number;
  pos_y?: number;
}

export type UpdateTableDto = Partial<CreateTableDto>;

export interface TableQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: TableStatus;
  zone?: string;
}

export interface OpenTableSessionDto {
  table_id: number;
  guest_count?: number;
  customer_id?: number;
}

export interface AddItemsToTableSessionDto {
  items: TableSessionAddItem[];
}

export interface TableSessionAddItem {
  product_id: number;
  product_variant_id?: number;
  quantity: number;
  price_tier_id?: number;
}

export type SplitMode = 'equal' | 'custom';

export interface SplitByItemsDto {
  item_groups: Array<{ order_item_ids: number[] }>;
}

export interface SplitByAmountDto {
  mode: SplitMode;
  n_splits: number;
  amounts?: number[];
}

export interface SplitResult {
  source_order_id: number;
  sub_orders: Array<{
    id: number;
    order_number: string;
    grand_total: number | string;
    items_count: number;
  }>;
}

/**
 * Payload for settling a table's bill through the unified POS payment
 * endpoint (`POST /store/payments/pos`) keyed by `table_session_id`.
 * `subtotal` + `total_amount` are required by the POS DTO validator even
 * though the backend re-derives the authoritative totals from the order.
 */
export interface PayTableSessionDto {
  table_session_id: number;
  store_payment_method_id: number;
  subtotal: number;
  total_amount: number;
  /** Cash received (only for cash methods, enables change calculation). */
  amount_received?: number;
  /** Reference for non-cash methods (transfer/card). */
  payment_reference?: string;
}

/**
 * Subset of the POS payment response we consume on the table-checkout
 * flow. The backend returns much more, but the table page only needs to
 * know the operation succeeded.
 */
export interface PayTableSessionResult {
  success?: boolean;
  message?: string;
  order?: {
    id: number;
    order_number?: string;
    status?: string;
    payment_status?: string;
    total_amount?: number;
  };
  payment?: {
    id: number;
    amount: number;
    change?: number;
  };
}

/**
 * Compact shape used to populate the product picker in the "Add items"
 * modal. We only need name + base_price + is_sellable for the
 * diner-style open check flow.
 */
export interface SellableProductOption {
  id: number;
  name: string;
  sku?: string | null;
  base_price?: number | string | null;
  is_sellable?: boolean;
  product_type?: 'physical' | 'service' | 'prepared';
  /**
   * Thumbnail URL for the product picker. Mirrors the field
   * `Product.image_url` returned by `ProductsService.getProducts` — the
   * modal casts the response to this shape and loses it at the type
   * level, so we carry it here to avoid `as any` in the template.
   */
  image_url?: string | null;
}
