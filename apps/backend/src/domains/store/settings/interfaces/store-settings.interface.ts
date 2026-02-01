export interface AppSettings {
  name: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  theme: 'default' | 'aura' | 'monocromo';
  logo_url?: string;
  favicon_url?: string;
}

export interface StoreSettings {
  general: GeneralSettings;
  inventory: InventorySettings;
  checkout: CheckoutSettings;

  notifications: NotificationsSettings;
  pos: PosSettings;
  receipts: ReceiptsSettings;
  app: AppSettings;
}

export interface GeneralSettings {
  timezone: string;
  currency: string;
  language: string;
  tax_included: boolean;
  // Campos de la tabla stores (sincronizados)
  name?: string;
  logo_url?: string;
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
