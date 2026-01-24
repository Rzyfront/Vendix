export interface StoreSettings {
  general: GeneralSettings;
  inventory: InventorySettings;
  checkout: CheckoutSettings;
  shipping: ShippingSettings;
  notifications: NotificationsSettings;
  pos: PosSettings;
  receipts: ReceiptsSettings;
}

export interface GeneralSettings {
  timezone: string;
  currency: string;
  language: string;
  tax_included: boolean;
  // Campos de la tabla stores
  name?: string;
  logo_url?: string | null;
  store_type?: 'physical' | 'online' | 'hybrid' | 'popup' | 'kiosko';
}

export interface InventorySettings {
  low_stock_threshold: number;
  out_of_stock_action: 'hide' | 'show' | 'disable' | 'allow_backorder';
  track_inventory: boolean;
  allow_negative_stock: boolean;
}

export interface CheckoutSettings {
  require_customer_data: boolean;
  allow_guest_checkout: boolean;
  allow_partial_payments: boolean;
  require_payment_confirmation: boolean;
}

export interface ShippingSettings {
  enabled: boolean;
  free_shipping_threshold: number;
  allow_pickup: boolean;
  default_shipping_method: string | null;
  shipping_types: ShippingTypesConfig;
  shipping_zones: ShippingZone[];
}

export interface CarrierConfig {
  tracking_enabled: boolean;
  estimated_days_min: number;
  estimated_days_max: number;
  requires_signature: boolean;
  requires_insurance: boolean;
  max_weight?: number | null;
  max_dimensions?: {
    length: number;
    width: number;
    height: number;
  } | null;
}

export interface StandardCarrier {
  id: string;
  name: string;
  type: 'fedex' | 'dhl' | 'ups' | 'correos' | 'estafeta' | 'custom';
  enabled: boolean;
  config: CarrierConfig;
}

export interface ExpressCarrierConfig {
  integration_enabled: boolean;
  priority: number;
  tracking_enabled: boolean;
  webhook_url?: string | null;
}

export interface ExpressCarrier {
  id: string;
  name: string;
  type: 'servientrega' | 'rappi' | 'didi' | 'uber_direct' | 'custom';
  enabled: boolean;
  config: ExpressCarrierConfig;
}

export interface LocalDeliveryConfig {
  coverage_radius?: number | null;
  estimated_minutes?: number | null;
  tracking_enabled: boolean;
}

export interface LocalDeliveryProvider {
  id: string;
  name: string;
  type: 'deliveri' | 'mensajeros' | 'motocicletas' | 'custom';
  enabled: boolean;
  config: LocalDeliveryConfig;
}

export interface ShippingTypesConfig {
  standard: {
    enabled: boolean;
    carriers: StandardCarrier[];
  };
  express: {
    enabled: boolean;
    carriers: ExpressCarrier[];
  };
  local: {
    enabled: boolean;
    allow_manual: boolean;
    delivery_providers: LocalDeliveryProvider[];
  };
}

export interface ShippingRule {
  carrier_id: string;
  base_price: number;
  price_per_kg: number;
  free_shipping_threshold?: number | null;
  estimated_days: number;
}

export interface ShippingZone {
  id: string;
  name: string;
  countries: string[];
  states: string[];
  cities: string[];
  zip_codes: string[];
  shipping_rules: ShippingRule[];
}

export interface NotificationsSettings {
  email_enabled: boolean;
  sms_enabled: boolean;
  low_stock_alerts: boolean;
  new_order_alerts: boolean;
  low_stock_alerts_email: string | null;
  new_order_alerts_email: string | null;
  low_stock_alerts_phone: string | null;
  new_order_alerts_phone: string | null;
}

export interface PosSettings {
  allow_anonymous_sales: boolean;
  anonymous_sales_as_default: boolean;
  business_hours: Record<string, BusinessHours>;
  offline_mode_enabled: boolean;
  require_cash_drawer_open: boolean;
  auto_print_receipt: boolean;
  allow_price_edit: boolean;
  allow_discount: boolean;
  max_discount_percentage: number;
  allow_refund_without_approval: boolean;
}

export interface ReceiptsSettings {
  print_receipt: boolean;
  email_receipt: boolean;
  receipt_header: string;
  receipt_footer: string;
}

export interface BusinessHours {
  open: string;
  close: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}
