export interface SalesOrder {
  id: number;
  organization_id: number;
  store_id: number;
  customer_id: number;
  order_number: string;
  status:
    | 'pending'
    | 'confirmed'
    | 'processing'
    | 'shipped'
    | 'delivered'
    | 'cancelled';
  order_date: Date;
  shipping_date?: Date;
  delivery_date?: Date;
  subtotal: number;
  tax_amount: number;
  shipping_cost: number;
  discount_amount: number;
  total_amount: number;
  notes?: string;
  internal_notes?: string;
  shipping_address_id?: number;
  billing_address_id?: number;
  created_at: Date;
  updated_at: Date;
}

export interface SalesOrderItem {
  id: number;
  sales_order_id: number;
  product_id: number;
  product_variant_id?: number;
  quantity: number;
  unit_price: number;
  discount_percentage?: number;
  tax_rate?: number;
  total_price: number;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateSalesOrderDto {
  customer_id: number;
  items: {
    product_id: number;
    product_variant_id?: number;
    quantity: number;
    unit_price: number;
    discount_percentage?: number;
    notes?: string;
  }[];
  shipping_address_id?: number;
  billing_address_id?: number;
  notes?: string;
  internal_notes?: string;
}

export interface UpdateSalesOrderDto {
  status?:
    | 'pending'
    | 'confirmed'
    | 'processing'
    | 'shipped'
    | 'delivered'
    | 'cancelled';
  shipping_date?: Date;
  delivery_date?: Date;
  notes?: string;
  internal_notes?: string;
  shipping_address_id?: number;
  billing_address_id?: number;
}

export interface SalesOrderQueryDto {
  page?: number;
  limit?: number;
  status?:
    | 'pending'
    | 'confirmed'
    | 'processing'
    | 'shipped'
    | 'delivered'
    | 'cancelled';
  customer_id?: number;
  store_id?: number;
  order_date_from?: Date;
  order_date_to?: Date;
  total_amount_min?: number;
  total_amount_max?: number;
  search?: string;
  sort_by?: 'order_date' | 'total_amount' | 'created_at';
  sort_order?: 'asc' | 'desc';
}
