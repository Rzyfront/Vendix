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
}

export interface InventorySettings {
  low_stock_threshold: number;
  out_of_stock_action: 'hide' | 'show' | 'disable' | 'allow_backorder';
  track_inventory: boolean;
  allow_negative_stock: boolean;
  require_serial_numbers: boolean;
  require_batch_tracking: boolean;
  auto_adjust_stock: boolean;
}

export interface CheckoutSettings {
  require_customer_data: boolean;
  require_email: boolean;
  require_phone: boolean;
  allow_guest_checkout: boolean;
  allow_partial_payments: boolean;
  payment_terms_days: number;
  require_payment_confirmation: boolean;
}

export interface ShippingSettings {
  enabled: boolean;
  free_shipping_threshold: number;
  shipping_zones: string[];
  allow_pickup: boolean;
  default_shipping_method: string | null;
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
