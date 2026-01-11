export enum PaymentMethodType {
  CASH = 'cash',
  CARD = 'card',
  PAYPAL = 'paypal',
  BANK_TRANSFER = 'bank_transfer',
  VOUCHER = 'voucher',
}

export enum ProcessingFeeType {
  FIXED = 'fixed',
  PERCENTAGE = 'percentage',
  MIXED = 'mixed',
}

export interface PaymentMethod {
  id: number;
  name: string;
  display_name: string;
  description?: string;
  type: PaymentMethodType;
  provider: string;
  logo_url?: string;
  requires_config: boolean;
  config_schema?: any;
  default_config?: any;
  supported_currencies?: string[];
  min_amount?: number;
  max_amount?: number;
  processing_fee_type?: ProcessingFeeType;
  processing_fee_value?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  _count?: {
    store_payment_methods: number;
  };
}

export interface PaymentMethodStats {
  total_methods: number;
  active_methods: number;
  inactive_methods: number;
  methods_requiring_config: number;
  total_stores_using_methods: number;
}

export interface CreatePaymentMethodDto {
  name: string;
  display_name: string;
  description?: string;
  type: PaymentMethodType;
  provider: string;
  logo_url?: string;
  requires_config?: boolean;
  config_schema?: any;
  default_config?: any;
  supported_currencies?: string[];
  min_amount?: number;
  max_amount?: number;
  processing_fee_type?: ProcessingFeeType;
  processing_fee_value?: number;
}

export interface UpdatePaymentMethodDto {
  display_name?: string;
  description?: string;
  logo_url?: string;
  requires_config?: boolean;
  config_schema?: any;
  default_config?: any;
  supported_currencies?: string[];
  min_amount?: number;
  max_amount?: number;
  processing_fee_type?: ProcessingFeeType;
  processing_fee_value?: number;
  is_active?: boolean;
}

export interface PaymentMethodQueryDto {
  search?: string;
  type?: PaymentMethodType;
  provider?: string;
  is_active?: boolean;
  requires_config?: boolean;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface PaymentMethodsPaginatedResponse {
  data: PaymentMethod[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}
