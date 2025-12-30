export interface PurchaseOrder {
  id: number;
  organization_id: number;
  supplier_id: number;
  location_id: number;
  order_number: string;
  status: 'draft' | 'approved' | 'received' | 'cancelled';
  order_date: Date;
  expected_date?: Date;
  received_date?: Date;
  subtotal: number;
  tax_amount?: number;
  total_amount: number;
  discount_amount?: number;
  shipping_cost?: number;
  payment_terms?: string;
  shipping_method?: string;
  notes?: string;
  internal_notes?: string;
  created_by_user_id: number;
  approved_by_user_id?: number;
  created_at: Date;
  updated_at: Date;
  purchase_order_items?: PurchaseOrderItem[];
}

export interface PurchaseOrderItem {
  id: number;
  purchase_order_id: number;
  product_id: number;
  product_variant_id?: number;
  quantity_ordered: number;
  quantity_received?: number;
  unit_cost: number;
  total_cost: number;
  notes?: string;
  batch_number?: string;
  manufacturing_date?: Date;
  expiration_date?: Date;
  created_at: Date;
}

export interface CreatePurchaseOrderRequest {
  supplier_id: number;
  location_id: number;
  expected_date?: string;
  payment_terms?: string;
  shipping_method?: string;
  shipping_cost?: number;
  notes?: string;
  internal_notes?: string;
  items: {
    product_id: number;
    product_variant_id?: number;
    quantity: number;
    unit_cost: number;
    notes?: string;
    batch_number?: string;
    manufacturing_date?: string;
    expiration_date?: string;
  }[];
}

export interface UpdatePurchaseOrderRequest {
  supplier_id?: number;
  location_id?: number;
  expected_date?: string;
  payment_terms?: string;
  shipping_method?: string;
  shipping_cost?: number;
  notes?: string;
  internal_notes?: string;
  status?: PurchaseOrder['status'];
  items?: {
    id?: number;
    product_id: number;
    product_variant_id?: number;
    quantity: number;
    unit_cost: number;
    notes?: string;
    batch_number?: string;
    manufacturing_date?: string;
    expiration_date?: string;
  }[];
}

export interface PurchaseOrderQuery {
  supplier_id?: number;
  location_id?: number;
  status?: PurchaseOrder['status'];
  start_date?: string;
  end_date?: string;
  min_total?: number;
  max_total?: number;
  search?: string;
}
