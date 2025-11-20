export enum PaymentMethodType {
  CASH = 'cash',
  CARD = 'card',
  PAYPAL = 'paypal',
  BANK_TRANSFER = 'bank_transfer',
}

export enum PaymentMethodState {
  ENABLED = 'enabled',
  DISABLED = 'disabled',
  ARCHIVED = 'archived',
  REQUIRES_CONFIGURATION = 'requires_configuration',
}

export enum ProcessingFeeType {
  FIXED = 'fixed',
  PERCENTAGE = 'percentage',
  MIXED = 'mixed',
}

export interface SystemPaymentMethod {
  id: string;
  name: string;
  display_name: string;
  description: string;
  type: PaymentMethodType;
  provider: string;
  is_active: boolean;
  requires_config: boolean;
  config_schema: Record<string, any>;
  default_config: Record<string, any>;
  supported_currencies: string[];
  min_amount?: number;
  max_amount?: number;
  processing_fee_type: ProcessingFeeType;
  processing_fee_value: number;
  created_at: string;
  updated_at: string;
}

export interface StorePaymentMethod {
  id: string;
  store_id: string;
  system_payment_method_id: string;
  display_name: string;
  custom_config: Record<string, any>;
  state: PaymentMethodState;
  display_order: number;
  min_amount?: number;
  max_amount?: number;
  created_at: string;
  updated_at: string;
  system_payment_method: SystemPaymentMethod;
}

export interface PaymentMethodStats {
  total_methods: number;
  enabled_methods: number;
  disabled_methods: number;
  requires_config: number;
  total_transactions: number;
  successful_transactions: number;
  failed_transactions: number;
  total_revenue: number;
}

export interface EnablePaymentMethodDto {
  display_name?: string;
  custom_config?: Record<string, any>;
  min_amount?: number;
  max_amount?: number;
}

export interface UpdateStorePaymentMethodDto {
  display_name?: string;
  custom_config?: Record<string, any>;
  min_amount?: number;
  max_amount?: number;
  display_order?: number;
}

export interface ReorderPaymentMethodsDto {
  payment_method_ids: string[];
}

export interface PaymentMethodsQueryParams {
  state?: PaymentMethodState;
  type?: PaymentMethodType;
  provider?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface PaginatedPaymentMethods {
  data: StorePaymentMethod[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface PaymentMethodConfigField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'textarea';
  label: string;
  description?: string;
  required: boolean;
  default?: any;
  options?: Array<{ label: string; value: any }>;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

export interface PaymentMethodConfiguration {
  fields: PaymentMethodConfigField[];
  validation_schema: Record<string, any>;
}
