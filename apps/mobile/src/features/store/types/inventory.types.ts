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

export interface StockMovement {
  id: string;
  product_id: string;
  product_name: string;
  type: 'purchase' | 'sale' | 'adjustment' | 'transfer_in' | 'transfer_out';
  quantity: number;
  location_name?: string;
  reference?: string;
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
export type MovementType = 'purchase' | 'sale' | 'adjustment' | 'transfer_in' | 'transfer_out';
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
  purchase: 'Compra',
  sale: 'Venta',
  adjustment: 'Ajuste',
  transfer_in: 'Transferencia Entrante',
  transfer_out: 'Transferencia Saliente',
};

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  warehouse: 'Bodega',
  store: 'Tienda',
  virtual: 'Virtual',
};
