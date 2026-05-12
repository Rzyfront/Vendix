export interface StockAdjustment {
  id: string;
  description: string;
  type: 'in' | 'out' | 'adjustment';
  product_id: string;
  product_name: string;
  quantity: number;
  reason?: string;
  location_id?: string;
  location_name?: string;
  state: 'pending' | 'applied';
  created_at: string;
  created_by?: string;
}

export interface StockTransfer {
  id: string;
  origin_location_id: string;
  origin_location_name: string;
  destination_location_id: string;
  destination_location_name: string;
  product_count: number;
  state: 'pending' | 'in_transit' | 'completed' | 'cancelled';
  created_at: string;
}

export type MovementType =
  | 'stock_in'
  | 'stock_out'
  | 'transfer'
  | 'adjustment'
  | 'sale'
  | 'return'
  | 'damage'
  | 'expiration';

export interface StockMovement {
  id: number;
  product_id: number;
  product_name: string;
  movement_type: MovementType;
  quantity: number;
  location_id: number | null;
  location_name: string | null;
  store_id: number | null;
  store_name: string | null;
  reference: string | null;
  notes: string | null;
  user_id: number | null;
  user_name: string | null;
  source_module: string | null;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  code?: string;
  email?: string;
  phone?: string;
  address?: string;
  state: 'active' | 'inactive';
  created_at: string;
}

export interface Location {
  id: string;
  name: string;
  code?: string;
  type: 'warehouse' | 'store' | 'virtual';
  address?: string;
  state: 'active' | 'inactive';
}

export type PurchaseOrderStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export interface PurchaseOrderItem {
  id: number;
  product_id: number;
  product_variant_id?: number | null;
  quantity_ordered: number;
  quantity_received?: number;
  unit_price: number;
  total_price?: number;
  product_name?: string;
  products?: { id: number; name: string; sku?: string | null };
  product?: { id: number; name: string; sku?: string | null };
}

export interface PurchaseOrder {
  id: number;
  order_number?: string;
  supplier_id: number;
  location_id: number;
  status: PurchaseOrderStatus;
  subtotal_amount?: number;
  tax_amount?: number;
  total_amount?: number;
  notes?: string;
  created_at: string;
  suppliers?: { id: number; name: string };
  inventory_locations?: { id: number; name: string };
  purchase_order_items?: PurchaseOrderItem[];
}

export interface CreatePurchaseOrderItemDto {
  product_id: number;
  product_variant_id?: number;
  quantity: number;
  unit_price: number;
  tax_rate?: number;
  notes?: string;
}

export interface CreatePurchaseOrderDto {
  supplier_id: number;
  location_id: number;
  status?: PurchaseOrderStatus;
  order_date?: string;
  expected_date?: string;
  subtotal_amount?: number;
  tax_amount?: number;
  total_amount?: number;
  discount_amount?: number;
  notes?: string;
  internal_notes?: string;
  items: CreatePurchaseOrderItemDto[];
}

export interface ReceivePurchaseOrderItemDto {
  id: number;
  quantity_received: number;
}

export interface InventoryStats {
  totalProducts: number;
  lowStock: number;
  outOfStock: number;
  totalValue: number;
  totalLocations: number;
}

export type AdjustmentType = 'in' | 'out' | 'adjustment';
export type AdjustmentState = 'pending' | 'applied';
export type TransferState = 'pending' | 'in_transit' | 'completed' | 'cancelled';
export type LocationType = 'warehouse' | 'store' | 'virtual';
export type SupplierState = 'active' | 'inactive';
export type LocationState = 'active' | 'inactive';

export const ADJUSTMENT_TYPE_LABELS: Record<AdjustmentType, string> = {
  in: 'Entrada',
  out: 'Salida',
  adjustment: 'Ajuste',
};

export const ADJUSTMENT_STATE_LABELS: Record<AdjustmentState, string> = {
  pending: 'Pendiente',
  applied: 'Aplicado',
};

export const TRANSFER_STATE_LABELS: Record<TransferState, string> = {
  pending: 'Pendiente',
  in_transit: 'En Tránsito',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  stock_in: 'Entrada',
  stock_out: 'Salida',
  transfer: 'Transferencia',
  adjustment: 'Ajuste',
  sale: 'Venta',
  return: 'Devolución',
  damage: 'Daño',
  expiration: 'Vencido',
};

export const MOVEMENT_INBOUND_TYPES: ReadonlySet<MovementType> = new Set<MovementType>([
  'stock_in',
  'return',
]);

export const MOVEMENT_OUTBOUND_TYPES: ReadonlySet<MovementType> = new Set<MovementType>([
  'stock_out',
  'sale',
  'damage',
  'expiration',
]);

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  warehouse: 'Bodega',
  store: 'Tienda',
  virtual: 'Virtual',
};
