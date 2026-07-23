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
  /** Rate identifier — semantic alias of `id`, returned by backend calculator. */
  rate_id?: number;
  method_id: number;
  method_name: string;
  method_type: string;
  /** Optional human-readable rate name (often same as method_name). */
  rate_name?: string;
  /** Optional zone label resolved by the calculator. */
  zone_name?: string;
  cost: number;
  currency: string;
  estimated_days?: { min: number; max: number };
}

/**
 * Modo de pago asociado a un envío. Usado por el wizard de envío del POS
 * para decidir si el cobro se hace en línea, contra entrega, o se
 * transfiere al checkout del e-commerce.
 */
export type PosShippingPaymentMode =
  | 'on_delivery'
  | 'online'
  | 'pay_now'
  | 'ecommerce';

