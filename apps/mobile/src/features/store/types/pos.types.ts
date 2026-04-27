import type { Product, ProductVariant } from './product.types';

export interface PosCustomer {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | null;
  document_number?: string | null;
}

export interface CartItem {
  id: string;
  product: Product;
  variant?: ProductVariant | null;
  quantity: number;
  unitPrice: number;
  finalPrice: number;
  totalPrice: number;
  taxAmount: number;
  notes?: string;
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
  discounts: CartDiscount[];
  summary: CartSummary;
}

export interface PaymentMethod {
  id: number;
  display_name: string;
  type: string;
  icon?: string;
}

export interface PaymentResult {
  order_id: number;
  order_number: string;
  transaction_id?: string;
  change?: number;
}

export type PosMode = 'sale' | 'quotation';
