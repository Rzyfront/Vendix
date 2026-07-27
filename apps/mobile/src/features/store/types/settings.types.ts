export interface AppSettings {
  name: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  theme: string;
  logo_url: string | null;
  favicon_url: string | null;
}

export interface GeneralSettings {
  timezone: string;
  currency: string;
  language: string;
  tax_included: boolean;
  name?: string;
  logo_url?: string | null;
  store_type?: string;
  industries?: string[];
  tax_id?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
}

export interface InventorySettings {
  low_stock_threshold: number;
  out_of_stock_action: 'hide' | 'show' | 'disable' | 'allow_backorder';
  track_inventory: boolean;
  allow_negative_stock: boolean;
  costing_method: 'cpp' | 'fifo';
  pos_stock_scope: 'main_location' | 'all_locations';
  low_stock_alerts_scope: 'main_location' | 'all_locations';
}

export interface OperationsSettings {
  default_preparation_time_minutes: number;
  ticket_closing_hour?: number;
}

export interface DispatchSettings {
  order_state_update_mode: 'live' | 'on_close';
}

export interface RestaurantSettings {
  enable_table_checkout: boolean;
}

export interface MembershipSettings {
  ambient_access_enabled: boolean;
  capacity_control_enabled?: boolean;
  max_capacity?: number;
  turnstile_mode?: boolean;
  auto_leveling_enabled?: boolean;
  auto_leveling_interval_hours?: number;
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
  sound_id: string | null;
  sound_volume: number;
  sound_muted: boolean;
}

export interface CashRegisterSettings {
  enabled: boolean;
  require_session_for_sales: boolean;
  allow_multiple_sessions_per_user: boolean;
  auto_create_default_register: boolean;
  require_closing_count: boolean;
  track_non_cash_payments: boolean;
}

export interface BarcodeScannerSettings {
  enabled: boolean;
}

export interface CustomerQueueSettings {
  enabled: boolean;
  queue_expiry_hours: number;
  max_queue_size: number;
  require_email: boolean;
}

export interface ScaleSettings {
  enabled: boolean;
  allow_manual_weight_entry: boolean;
  default_weight_unit: 'kg' | 'g' | 'lb';
  baud_rate?: number;
  protocol?: string;
}

export interface PosSettings {
  allow_anonymous_sales: boolean;
  anonymous_sales_as_default: boolean;
  enable_schedule_validation: boolean;
  show_onscreen_keypad: boolean;
  auto_print_receipt: boolean;
  allow_price_edit: boolean;
  allow_discount: boolean;
  max_discount_percentage: number;
  allow_refund_without_approval: boolean;
  schedule_mode?: 'continuous' | 'custom';
  business_hours?: Record<string, { open: string; close: string; closed: boolean; blocks?: Array<{ open: string; close: string }> }>;
  cash_register?: CashRegisterSettings;
  barcode_scanner?: BarcodeScannerSettings;
  scale?: ScaleSettings;
  customer_queue?: CustomerQueueSettings;
}

export interface ReceiptsSettings {
  print_receipt: boolean;
  email_receipt: boolean;
  receipt_header: string;
  receipt_footer: string;
}

export interface StoreSettings {
  general: GeneralSettings;
  inventory: InventorySettings;
  checkout: CheckoutSettings;
  notifications: NotificationsSettings;
  pos: PosSettings;
  receipts: ReceiptsSettings;
  app: AppSettings;
  operations?: OperationsSettings;
  dispatch?: DispatchSettings;
  restaurant?: RestaurantSettings;
  membership?: MembershipSettings;
  panel_ui?: PanelUiSettings;

  // Compatibility fields
  name?: string;
  tax_id?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  logo_url?: string;
  currency?: string;
  country?: string;
}

/**
 * Estado de visibilidad de módulos en el panel. Refleja el shape que el
 * backend persiste y devuelve (`store_settings.settings.panel_ui`):
 * `{ [app: string]: { [moduleKey: string]: boolean } }`. El adapter en
 * `settings.service.ts` aplana la raíz `panel_ui` (`STORE_ADMIN`,
 * `STORE_ECOMMERCE`) cuando escribe y la vuelve a anidar al normalizar
 * la respuesta.
 */
export interface PanelUiSettings {
  STORE_ADMIN?: Record<string, boolean>;
  STORE_ECOMMERCE?: Record<string, boolean>;
  [app: string]: Record<string, boolean> | undefined;
}

export interface StoreUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role_id?: string;
  role_name?: string;
  state: 'active' | 'inactive';
  created_at: string;
}

export interface StoreRole {
  id: string;
  name: string;
  description?: string;
  user_count: number;
  is_default: boolean;
}

export interface SettingsPaymentMethod {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

export interface CreateStoreUserDto {
  first_name: string;
  last_name: string;
  email: string;
  role_id?: string;
  send_invite?: boolean;
}

export interface UpdateStoreUserDto {
  first_name?: string;
  last_name?: string;
  email?: string;
  role_id?: string;
}

export interface CreateStoreRoleDto {
  name: string;
  description?: string;
}

export interface UpdateStoreRoleDto {
  name?: string;
  description?: string;
}
