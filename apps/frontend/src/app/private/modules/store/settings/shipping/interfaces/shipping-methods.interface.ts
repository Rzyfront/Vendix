export enum ShippingMethodType {
  CUSTOM = 'custom',
  PICKUP = 'pickup',
  OWN_FLEET = 'own_fleet',
  CARRIER = 'carrier',
  THIRD_PARTY_PROVIDER = 'third_party_provider',
}

export type DispatchPaymentTiming = 'prepaid' | 'on_delivery';
export type CostSettlementTiming = 'immediate_on_close';

/**
 * Plan Despacho Economía — FASE 2 paso 8.
 * Política efectiva devuelta por GET /store/shipping/methods/:id/policy.
 */
export interface ShippingMethodEffectivePolicy {
  method_id: number;
  method_type: ShippingMethodType;
  collects_payment: boolean;
  payment_timing: DispatchPaymentTiming | null;
  generates_transport_cost: 'none' | 'per_delivery' | 'per_route';
  default_vehicle_id: number | null;
  default_driver_user_id: number | null;
  default_carrier_supplier_id: number | null;
  cost_settlement_timing: CostSettlementTiming | null;
  store_defaults: Record<string, unknown>;
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
  // Plan Despacho Economía — FASE 2 paso 8.
  collects_payment?: boolean;
  payment_timing?: DispatchPaymentTiming;
  generates_transport_cost?: 'none' | 'per_delivery' | 'per_route';
  default_vehicle_id?: number | null;
  default_driver_user_id?: number | null;
  default_carrier_supplier_id?: number | null;
  cost_settlement_timing?: CostSettlementTiming;
  created_at: string;
  updated_at: string;
}

// Store's shipping method (a copy of a system method with store_id set)
export interface StoreShippingMethod {
  id: number;
  store_id: number;
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
  custom_config?: Record<string, any>;
  min_order_amount?: number;
  max_order_amount?: number;
  // Plan Despacho Economía — FASE 2 paso 8.
  collects_payment?: boolean;
  payment_timing?: DispatchPaymentTiming;
  generates_transport_cost?: 'none' | 'per_delivery' | 'per_route';
  default_vehicle_id?: number | null;
  default_driver_user_id?: number | null;
  default_carrier_supplier_id?: number | null;
  cost_settlement_timing?: CostSettlementTiming;
  copied_from_system_method_id?: number;
  created_at: string;
  updated_at: string;
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
  name?: string;
  custom_config?: Record<string, any>;
  min_order_amount?: number;
  max_order_amount?: number;
  collects_payment?: boolean;
  payment_timing?: DispatchPaymentTiming;
  generates_transport_cost?: 'none' | 'per_delivery' | 'per_route';
  default_vehicle_id?: number;
  default_driver_user_id?: number;
  default_carrier_supplier_id?: number;
  cost_settlement_timing?: CostSettlementTiming;
}

export interface UpdateStoreShippingMethodDto {
  name?: string;
  is_active?: boolean;
  custom_config?: Record<string, any>;
  min_order_amount?: number;
  max_order_amount?: number;
  display_order?: number;
  collects_payment?: boolean;
  payment_timing?: DispatchPaymentTiming;
  generates_transport_cost?: 'none' | 'per_delivery' | 'per_route';
  default_vehicle_id?: number;
  default_driver_user_id?: number;
  default_carrier_supplier_id?: number;
  cost_settlement_timing?: CostSettlementTiming;
}

export interface ReorderShippingMethodsDto {
  methods: { id: number }[];
}
