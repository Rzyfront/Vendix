import { Product, PosProductVariant } from '../services/pos-product.service';
import { PosCustomer } from '../models/customer.model';

export interface CartItem {
  id: string;
  product: Product;
  quantity: number;
  unitPrice: number;
  finalPrice: number;
  totalPrice: number;
  taxAmount: number;
  addedAt: Date;
  notes?: string;
  discounts?: CartDiscount[];
  variant_id?: number;
  variant_sku?: string;
  variant_attributes?: string;
  variant_display_name?: string;
  // Weight product fields
  weight?: number;
  weight_unit?: 'kg' | 'g' | 'lb';
  is_weight_product?: boolean;
}

export interface CartDiscount {
  id: string;
  type: 'percentage' | 'fixed';
  value: number;
  description: string;
  amount: number;
  promotion_id?: number;
  coupon_id?: number;
  coupon_code?: string;
  is_auto_applied?: boolean;
}

export interface CartSummary {
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  itemCount: number;
  totalItems: number;
}

export interface PendingBooking {
  id: number;
  booking_number: string;
  product_id: number;
  product_name: string;
  customer_id: number;
  date: string;
  start_time: string;
  end_time: string;
  provider_name?: string;
}

export interface CartState {
  items: CartItem[];
  customer: PosCustomer | null;
  notes: string;
  appliedDiscounts: CartDiscount[];
  appliedCoupon?: { id: number; code: string; discount_type: string; discount_value: number };
  pendingBookings: PendingBooking[];
  summary: CartSummary;
  createdAt: Date;
  updatedAt: Date;
}

export interface AddToCartRequest {
  product: Product;
  quantity: number;
  notes?: string;
  variant?: PosProductVariant;
  // Weight product fields
  weight?: number;
  weight_unit?: 'kg' | 'g' | 'lb';
}

export interface UpdateCartItemRequest {
  itemId: string;
  quantity: number;
  notes?: string;
}

export interface ApplyDiscountRequest {
  type: 'percentage' | 'fixed';
  value: number;
  description: string;
  promotion_id?: number;
}

export interface CartValidationError {
  field: string;
  message: string;
  itemId?: string;
}

