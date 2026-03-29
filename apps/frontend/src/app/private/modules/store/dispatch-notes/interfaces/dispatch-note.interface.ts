export type DispatchNoteStatus = 'draft' | 'confirmed' | 'delivered' | 'invoiced' | 'voided';

export interface DispatchNoteItem {
  id: number;
  dispatch_note_id: number;
  product_id: number;
  product_variant_id?: number;
  location_id?: number;
  ordered_quantity: number;
  dispatched_quantity: number;
  unit_price?: number;
  discount_amount?: number;
  tax_amount?: number;
  total_price?: number;
  cost_price?: number;
  lot_serial?: string;
  sales_order_item_id?: number;
  created_at: string;
  product?: any;
  product_variant?: any;
  location?: any;
}

export interface DispatchNote {
  id: number;
  store_id: number;
  dispatch_number: string;
  status: DispatchNoteStatus;
  customer_id: number;
  customer_name: string;
  customer_tax_id?: string;
  customer_address?: any;
  sales_order_id?: number;
  invoice_id?: number;
  emission_date: string;
  agreed_delivery_date?: string;
  actual_delivery_date?: string;
  dispatch_location_id?: number;
  subtotal_amount: number;
  discount_amount: number;
  tax_amount: number;
  grand_total: number;
  currency?: string;
  notes?: string;
  internal_notes?: string;
  void_reason?: string;
  created_by_user_id?: number;
  confirmed_by_user_id?: number;
  delivered_by_user_id?: number;
  voided_by_user_id?: number;
  confirmed_at?: string;
  delivered_at?: string;
  voided_at?: string;
  created_at: string;
  updated_at: string;
  dispatch_note_items?: DispatchNoteItem[];
  customer?: any;
  sales_order?: any;
  invoice?: any;
  dispatch_location?: any;
  created_by_user?: any;
  confirmed_by_user?: any;
  delivered_by_user?: any;
  voided_by_user?: any;
}

export interface DispatchNoteStats {
  total: number;
  draft: number;
  confirmed: number;
  delivered: number;
  invoiced: number;
  voided: number;
}

export interface DispatchNoteQuery {
  status?: DispatchNoteStatus;
  customer_id?: number;
  sales_order_id?: number;
  date_from?: string;
  date_to?: string;
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface PaginatedDispatchNotesResponse {
  data: DispatchNote[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface CreateDispatchNoteItemDto {
  product_id: number;
  product_variant_id?: number;
  location_id?: number;
  ordered_quantity: number;
  dispatched_quantity: number;
  unit_price?: number;
  discount_amount?: number;
  tax_amount?: number;
  lot_serial?: string;
  sales_order_item_id?: number;
}

export interface CreateDispatchNoteDto {
  customer_id: number;
  sales_order_id?: number;
  dispatch_location_id?: number;
  emission_date?: string;
  agreed_delivery_date?: string;
  notes?: string;
  internal_notes?: string;
  currency?: string;
  items: CreateDispatchNoteItemDto[];
}
