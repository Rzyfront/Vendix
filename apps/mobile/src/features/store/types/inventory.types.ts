export interface StockAdjustment {
  id: number;
  organization_id: number;
  product_id: number;
  product_variant_id: number | null;
  location_id: number;
  batch_id: number | null;
  adjustment_type: AdjustmentType;
  quantity_before: number;
  quantity_after: number;
  quantity_change: number;
  reason_code: string | null;
  description: string | null;
  approved_by_user_id: number | null;
  created_by_user_id: number | null;
  approved_at: string | null;
  created_at: string;
  // Relations
  products?: { id: number; name: string; sku: string | null } | null;
  product_variants?: { id: number; sku: string; name: string | null } | null;
  inventory_locations?: { id: number; name: string; store_id?: number | null } | null;
}

export interface StockTransfer {
  id: string;
  /** Web-style transfer number (e.g. "TRF-20260625-0001"). Falls back to id when absent. */
  transfer_number?: string;
  origin_location_id: string;
  origin_location_name: string;
  destination_location_id: string;
  destination_location_name: string;
  product_count: number;
  /** Date the transfer was created (ISO). */
  transfer_date?: string;
  /** Expected delivery date (ISO). */
  expected_date?: string;
  /** Count of distinct items (sometimes richer than product_count). */
  items_count?: number;
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
  contact_person?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  website?: string;
  tax_id?: string;
  payment_terms?: string;
  currency?: string;
  lead_time_days?: number | null;
  notes?: string;
  address?: string;
  is_active: boolean;
  created_at: string;
}

export interface Location {
  id: string;
  name: string;
  code?: string;
  type: 'warehouse' | 'store' | 'virtual';
  address?: string;
  is_active: boolean;
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

export type AdjustmentType = 'damage' | 'loss' | 'theft' | 'expiration' | 'count_variance' | 'manual_correction';
export type AdjustmentState = 'pending' | 'applied';
export type TransferState = 'pending' | 'in_transit' | 'completed' | 'cancelled';
export type LocationType = 'warehouse' | 'store' | 'virtual';

/**
 * Aliases legacy — mantener para compatibilidad hacia atrás.
 * El contrato real del backend es `is_active: boolean`
 * (ver Prisma `inventory_locations`/`suppliers`, backend DTOs en
 * `apps/backend/src/domains/store/inventory/{locations,suppliers}/dto/`,
 * y el frontend Angular `inventory.interface.ts`).
 * NO usar en código nuevo — usar `item.is_active` directamente.
 */
export type SupplierState = 'active' | 'inactive';
export type LocationState = 'active' | 'inactive';

export const ADJUSTMENT_TYPE_LABELS: Record<AdjustmentType, string> = {
  damage: 'Daño',
  loss: 'Pérdida',
  theft: 'Robo',
  expiration: 'Vencido',
  count_variance: 'Conteo',
  manual_correction: 'Corrección',
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

export interface ConsolidatedStock {
  product_id: number;
  totalAvailable: number;
  totalReserved: number;
  totalOnHand: number;
  stockByLocation: LocationStock[];
  product?: { name: string; sku?: string };
}

export interface LocationStock {
  locationId: number;
  locationName: string;
  available: number;
  reserved: number;
  onHand: number;
  type: string;
  lastUpdated: string;
}

export interface StockAlert {
  product_id: number;
  product_name: string;
  location_id: number;
  location_name: string;
  current_stock: number;
  reorder_point: number;
  status: 'low_stock' | 'out_of_stock' | 'optimal';
}

export interface SourcingSuggestion {
  product_id: number;
  main_location: { id: number; name: string; available: number } | null;
  other_locations: { id: number; name: string; available: number }[];
  suggestion: 'available' | 'transfer' | 'purchase';
  requested_quantity: number;
}

export type PurchaseOrderMode = 'draft' | 'create' | 'create-receive';
