export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted' | 'cancelled';

export interface QuotationItem {
  id: number;
  quotation_id: number;
  product_id?: number;
  product_variant_id?: number;
  product_name: string;
  variant_sku?: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_rate?: number;
  tax_amount_item?: number;
  total_price: number;
  notes?: string;
  product?: any;
  product_variant?: any;
}

export interface Quotation {
  id: number;
  store_id: number;
  customer_id?: number;
  quotation_number: string;
  status: QuotationStatus;
  channel: string;
  subtotal_amount: number;
  discount_amount: number;
  tax_amount: number;
  shipping_cost: number;
  grand_total: number;
  valid_until?: string;
  notes?: string;
  internal_notes?: string;
  terms_and_conditions?: string;
  sent_at?: string;
  accepted_at?: string;
  rejected_at?: string;
  converted_at?: string;
  converted_order_id?: number;
  created_by_user_id?: number;
  created_at: string;
  updated_at: string;
  quotation_items: QuotationItem[];
  customer?: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
  };
  created_by_user?: {
    id: number;
    first_name: string;
    last_name: string;
  };
  converted_order?: {
    id: number;
    order_number: string;
    state: string;
    grand_total: number;
  };
}

export interface QuotationQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: QuotationStatus;
  customer_id?: number;
  date_from?: string;
  date_to?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface PaginatedQuotationsResponse {
  data: Quotation[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface QuotationStats {
  total: number;
  pending: number;
  conversion_rate: number;
  average_value: number;
  draft: number;
  sent: number;
  accepted: number;
  converted: number;
}

export interface CreateQuotationItemDto {
  product_id?: number;
  product_variant_id?: number;
  product_name: string;
  variant_sku?: string;
  quantity: number;
  unit_price: number;
  discount_amount?: number;
  tax_rate?: number;
  tax_amount_item?: number;
  total_price: number;
  notes?: string;
}

export interface CreateQuotationDto {
  customer_id?: number;
  channel?: string;
  valid_until?: string;
  notes?: string;
  internal_notes?: string;
  terms_and_conditions?: string;
  items: CreateQuotationItemDto[];
}
