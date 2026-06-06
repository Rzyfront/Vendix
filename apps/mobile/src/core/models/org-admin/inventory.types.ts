import type { ISODateString, MoneyAmount } from './common.types';

export interface StockLevel {
  id: string;
  product_id: string;
  product_name: string;
  product_sku?: string;
  store_id?: string;
  store_name?: string;
  location_id?: string;
  location_name?: string;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  min_stock?: number;
  max_stock?: number;
  reorder_point?: number;
  unit_cost?: MoneyAmount;
  total_value?: MoneyAmount;
  updated_at: ISODateString;
}

export interface InventoryLocation {
  id: string;
  name: string;
  code?: string;
  type: 'WAREHOUSE' | 'STORE' | 'CENTRAL' | 'TRANSIT';
  address?: string;
  city?: string;
  is_active: boolean;
  is_central_warehouse?: boolean;
  organization_id: string;
  store_id?: string;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface InventoryMovement {
  id: string;
  product_id: string;
  product_name: string;
  store_id?: string;
  store_name?: string;
  location_id?: string;
  location_name?: string;
  type: 'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT';
  quantity: number;
  unit_cost?: MoneyAmount;
  reason?: string;
  reference?: string;
  source?: string;
  created_at: ISODateString;
  created_by?: string;
}

export interface InventorySupplier {
  id: string;
  name: string;
  code?: string;
  tax_id?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  contact_name?: string;
  notes?: string;
  is_active: boolean;
  organization_id: string;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface StockTransfer {
  id: string;
  transfer_number: string;
  from_store_id: string;
  from_store_name: string;
  to_store_id: string;
  to_store_name: string;
  status: 'DRAFT' | 'PENDING' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';
  total_items: number;
  total_quantity: number;
  expected_date?: ISODateString;
  shipped_at?: ISODateString;
  received_at?: ISODateString;
  notes?: string;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface StockAdjustment {
  id: string;
  adjustment_number: string;
  store_id: string;
  store_name: string;
  location_id?: string;
  location_name?: string;
  type: 'INCREASE' | 'DECREASE';
  reason: string;
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';
  total_items: number;
  total_quantity: number;
  total_value_impact?: MoneyAmount;
  approved_at?: ISODateString;
  approved_by?: string;
  notes?: string;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface SerialNumber {
  id: string;
  product_id: string;
  product_name: string;
  store_id?: string;
  store_name?: string;
  serial: string;
  status: 'AVAILABLE' | 'SOLD' | 'RESERVED' | 'DEFECTIVE' | 'RETURNED';
  batch_id?: string;
  cost?: MoneyAmount;
  created_at: ISODateString;
  sold_at?: ISODateString;
}

export interface InventoryBatch {
  id: string;
  batch_number: string;
  product_id: string;
  product_name: string;
  store_id?: string;
  store_name?: string;
  quantity: number;
  available_quantity: number;
  cost?: MoneyAmount;
  manufacturing_date?: ISODateString;
  expiration_date?: ISODateString;
  status: 'ACTIVE' | 'EXPIRED' | 'DEPLETED' | 'QUARANTINE';
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface InventoryStats {
  total_products: number;
  total_locations: number;
  low_stock_count: number;
  expiring_batches_count: number;
  total_value: MoneyAmount;
  total_quantity: number;
}

export interface StockLevelAlert {
  product_id: string;
  product_name: string;
  store_name?: string;
  current_quantity: number;
  min_stock: number;
  reorder_point?: number;
  severity: 'LOW' | 'CRITICAL' | 'OUT';
}
