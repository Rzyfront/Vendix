export interface Coupon {
  id: number;
  store_id: number;
  code: string;
  name: string;
  description?: string;
  discount_type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discount_value: number;
  min_purchase_amount?: number;
  max_discount_amount?: number;
  max_uses?: number;
  max_uses_per_customer?: number;
  current_uses: number;
  valid_from: string;
  valid_until: string;
  is_active: boolean;
  applies_to: 'ALL_PRODUCTS' | 'SPECIFIC_PRODUCTS' | 'SPECIFIC_CATEGORIES';
  created_at: string;
  updated_at: string;
  coupon_products?: { product: { id: number; name: string; sku?: string } }[];
  coupon_categories?: { category: { id: number; name: string } }[];
  _count?: { coupon_uses: number };
}

export interface CouponStats {
  total_coupons: number;
  active_coupons: number;
  total_uses: number;
  total_discount_applied: number;
}

export interface CreateCouponRequest {
  code: string;
  name: string;
  description?: string;
  discount_type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discount_value: number;
  min_purchase_amount?: number;
  max_discount_amount?: number;
  max_uses?: number;
  max_uses_per_customer?: number;
  valid_from: string;
  valid_until: string;
  is_active?: boolean;
  applies_to?: 'ALL_PRODUCTS' | 'SPECIFIC_PRODUCTS' | 'SPECIFIC_CATEGORIES';
  product_ids?: number[];
  category_ids?: number[];
}

export interface UpdateCouponRequest extends Partial<CreateCouponRequest> {}

export interface ValidateCouponRequest {
  code: string;
  cart_subtotal: number;
  customer_id?: number;
  product_ids?: number[];
  category_ids?: number[];
}

export interface ValidateCouponResponse {
  valid: boolean;
  coupon_id: number;
  code: string;
  name: string;
  discount_type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discount_value: number;
  discount_amount: number;
  min_purchase_amount: number | null;
  max_discount_amount: number | null;
}

export interface CouponQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  is_active?: boolean;
  discount_type?: 'PERCENTAGE' | 'FIXED_AMOUNT';
}
