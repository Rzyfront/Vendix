export type TransferStatus = 'draft' | 'in_transit' | 'completed' | 'cancelled';

export interface StockTransfer {
  id: number;
  transfer_number: string;
  organization_id: number;
  from_location_id: number;
  to_location_id: number;
  status: TransferStatus;
  transfer_date: string;
  expected_date?: string;
  completed_date?: string;
  approved_date?: string;
  cancelled_date?: string;
  started_date?: string;
  notes?: string;
  reference_number?: string;
  reason?: string;
  created_by_user_id?: number;
  approved_by_user_id?: number;
  created_at: string;
  updated_at: string;
  from_location: InventoryLocation;
  to_location: InventoryLocation;
  stock_transfer_items: StockTransferItem[];
}

export interface InventoryLocation {
  id: number;
  name: string;
  code?: string;
  type?: string;
}

export interface StockTransferItem {
  id: number;
  stock_transfer_id: number;
  product_id: number;
  product_variant_id?: number;
  quantity: number;
  quantity_received?: number;
  cost_per_unit?: number;
  notes?: string;
  received_date?: string;
  products: {
    id: number;
    name: string;
    sku?: string;
  };
  product_variants?: {
    id: number;
    name: string;
    sku?: string;
  };
}

export interface TransferStats {
  total: number;
  draft: number;
  in_transit: number;
  completed: number;
  cancelled: number;
}

export interface TransferQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: TransferStatus;
  from_location_id?: number;
  to_location_id?: number;
  transfer_date_from?: string;
  transfer_date_to?: string;
}

export interface CreateTransferRequest {
  from_location_id: number;
  to_location_id: number;
  expected_date?: string;
  notes?: string;
  items: CreateTransferItemRequest[];
}

export interface CreateTransferItemRequest {
  product_id: number;
  product_variant_id?: number;
  quantity: number;
  cost_per_unit?: number;
  notes?: string;
}

export interface CompleteTransferItem {
  id: number;
  quantity_received: number;
}

export interface LocationStock {
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
}

export interface TransferableProduct {
  id: number;
  name: string;
  sku: string | null;
  stock_at_origin: LocationStock;
  stock_at_destination: LocationStock;
}
