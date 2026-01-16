export interface PaymentMethod {
  id: number;
  name: string;
  display_name: string;
  description?: string | null;
  type: string;
  provider: string;
  logo_url?: string | null;
  is_active: boolean;
  is_allowed: boolean;
  requires_config: boolean;
  supported_currencies: string[];
  min_amount?: number;
  max_amount?: number;
}

export interface UpdatePaymentMethodsRequest {
  allowed_methods: string[];
}

export type PaymentMethodType =
  | 'cash'
  | 'card'
  | 'paypal'
  | 'bank_transfer'
  | 'voucher';

export interface PaymentMethodStats {
  total_methods: number;
  active_methods: number;
  selected_methods: number;
  available_methods: number;
}
