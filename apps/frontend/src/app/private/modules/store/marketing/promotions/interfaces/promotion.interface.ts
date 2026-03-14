export interface Promotion {
  id: number;
  store_id: number;
  name: string;
  description?: string;
  code?: string;
  type: 'percentage' | 'fixed_amount';
  value: number;
  scope: 'order' | 'product' | 'category';
  min_purchase_amount?: number;
  max_discount_amount?: number;
  usage_limit?: number;
  usage_count: number;
  per_customer_limit?: number;
  start_date: string;
  end_date?: string;
  state: 'draft' | 'scheduled' | 'active' | 'paused' | 'expired' | 'cancelled';
  is_auto_apply: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
  promotion_products?: PromotionProduct[];
  promotion_categories?: PromotionCategory[];
  _count?: { order_promotions: number };
}

export interface PromotionProduct {
  id: number;
  promotion_id: number;
  product_id: number;
  products?: { id: number; name: string; sku: string; base_price: number };
}

export interface PromotionCategory {
  id: number;
  promotion_id: number;
  category_id: number;
  categories?: { id: number; name: string };
}

export interface CreatePromotionDto {
  name: string;
  description?: string;
  code?: string;
  type: 'percentage' | 'fixed_amount';
  value: number;
  scope?: 'order' | 'product' | 'category';
  min_purchase_amount?: number;
  max_discount_amount?: number;
  usage_limit?: number;
  per_customer_limit?: number;
  start_date: string;
  end_date?: string;
  is_auto_apply?: boolean;
  priority?: number;
  product_ids?: number[];
  category_ids?: number[];
}

export interface UpdatePromotionDto extends Partial<CreatePromotionDto> {}

export interface QueryPromotionsDto {
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  state?: string;
  type?: string;
  scope?: string;
}

export interface PromotionsSummary {
  total_active: number;
  total_scheduled: number;
  total_discount_given: number;
  total_usage: number;
}

export interface PromotionsListResponse {
  data: Promotion[];
  meta: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: any;
}
