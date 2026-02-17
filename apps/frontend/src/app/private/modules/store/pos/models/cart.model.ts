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
}

export interface CartDiscount {
  id: string;
  type: 'percentage' | 'fixed';
  value: number;
  description: string;
  amount: number;
}

export interface CartSummary {
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  itemCount: number;
  totalItems: number;
}

export interface CartState {
  items: CartItem[];
  customer: PosCustomer | null;
  notes: string;
  appliedDiscounts: CartDiscount[];
  summary: CartSummary;
  createdAt: Date;
  updatedAt: Date;
}

export interface AddToCartRequest {
  product: Product;
  quantity: number;
  notes?: string;
  variant?: PosProductVariant;
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
}

export interface CartValidationError {
  field: string;
  message: string;
  itemId?: string;
}
