import { Product } from '../services/pos-product.service';
import { PosCustomer } from '../models/customer.model';

export interface CartItem {
  id: string;
  product: Product;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  taxAmount: number;
  addedAt: Date;
  notes?: string;
  discounts?: CartDiscount[];
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
