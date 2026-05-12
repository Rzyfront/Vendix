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
  display_name?: string;
  name?: string;
  type: string;
  icon?: string;
  state?: string;
  system_payment_method?: {
    id?: number;
    name?: string;
    display_name?: string;
    type?: string;
    dian_code?: string;
  };
}

export interface CreatePosPaymentItemDto {
  product_id: number;
  product_variant_id?: number;
  product_name: string;
  product_sku?: string;
  variant_sku?: string;
  variant_attributes?: Record<string, unknown>;
  quantity: number;
  unit_price: number;
  total_price: number;
  tax_amount_item?: number;
  cost?: number;
}

export interface CreatePosPaymentDto {
  customer_id?: number;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  store_id?: number;
  items: CreatePosPaymentItemDto[];
  subtotal: number;
  tax_amount?: number;
  discount_amount?: number;
  total_amount: number;
  currency?: string;
  store_payment_method_id?: number;
  amount_received?: number;
  payment_reference?: string;
  requires_payment?: boolean;
  delivery_type?: string;
  internal_notes?: string;
  update_inventory?: boolean;
  allow_oversell?: boolean;
  print_receipt?: boolean;
  payment_form?: string;
  credit_type?: 'free' | 'installments';
}

export interface PosPaymentResponse {
  success: boolean;
  message: string;
  errors?: string[];
  order?: {
    id: number;
    order_number: string;
    status: string;
    payment_status: string;
    total_amount: number;
    invoice_data_token?: string;
  };
  payment?: {
    id?: number;
    amount?: number;
    payment_method?: string;
    status?: string;
    transaction_id?: string;
    change?: number;
  };
}

export interface PaymentResult {
  order_id: number;
  order_number: string;
  transaction_id?: string;
  change?: number;
}

export type PosMode = 'sale' | 'quotation';
