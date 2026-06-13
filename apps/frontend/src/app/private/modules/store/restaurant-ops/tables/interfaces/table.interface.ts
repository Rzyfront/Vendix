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
  order_items: TableSessionOrderItem[];
}

export interface TableSessionOrderItem {
  id: number;
  product_id: number | null;
  product_name: string;
  quantity: number;
  unit_price: number | string;
  total_price: number | string;
  inventory_consumed_at_fire: boolean;
}

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
}
