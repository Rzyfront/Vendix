export enum ShippingMethodType {
  CUSTOM = 'custom',
  PICKUP = 'pickup',
  OWN_FLEET = 'own_fleet',
  CARRIER = 'carrier',
  THIRD_PARTY_PROVIDER = 'third_party_provider',
}

export enum ShippingMethodState {
  ENABLED = 'enabled',
  DISABLED = 'disabled',
  ARCHIVED = 'archived',
}

export interface SystemShippingMethod {
  id: number;
  name: string;
  code?: string;
  description?: string;
  logo_url?: string;
  type: ShippingMethodType;
  provider_name?: string;
  tracking_url?: string;
  min_days?: number;
  max_days?: number;
  is_active: boolean;
  is_system: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface StoreShippingMethod {
  id: number;
  store_id: number;
  system_shipping_method_id: number;
  display_name?: string;
  custom_config?: Record<string, any>;
  state: ShippingMethodState;
  display_order: number;
  min_order_amount?: number;
  max_order_amount?: number;
  created_at: string;
  updated_at: string;
  system_shipping_method: SystemShippingMethod;
}

export interface ShippingMethodStats {
  total_methods: number;
  enabled_methods: number;
  disabled_methods: number;
  orders_using_shipping: number;
  // Extended stats from unified getStats()
  total_zones?: number;
  system_copy_zones?: number;
  custom_zones?: number;
  total_rates?: number;
}

export interface EnableShippingMethodDto {
  display_name?: string;
  custom_config?: Record<string, any>;
  min_order_amount?: number;
  max_order_amount?: number;
}

export interface UpdateStoreShippingMethodDto {
  display_name?: string;
  custom_config?: Record<string, any>;
  min_order_amount?: number;
  max_order_amount?: number;
  display_order?: number;
}

export interface ReorderShippingMethodsDto {
  methods: { id: number }[];
}
