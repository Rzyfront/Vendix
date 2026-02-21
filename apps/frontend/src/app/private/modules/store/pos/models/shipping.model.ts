export interface PosShippingMethod {
  id: number;
  name: string;
  type: string; // 'pickup' | 'own_fleet' | 'carrier' | 'custom' | 'third_party_provider'
  description?: string;
  is_active: boolean;
  display_order?: number;
  min_days?: number;
  max_days?: number;
}

export interface PosShippingAddress {
  address_line1: string;
  address_line2?: string;
  city: string;
  state_province?: string;
  postal_code?: string;
  country_code: string;
  recipient_name?: string;
  recipient_phone?: string;
}

export interface PosShippingOption {
  id: number;
  method_id: number;
  method_name: string;
  method_type: string;
  cost: number;
  currency: string;
  estimated_days?: { min: number; max: number };
}

export type PosShippingPaymentMode = 'on_delivery' | 'pay_now';
