import type { FiscalStatusBlock } from './fiscal-status.model';
import type { StoreIndustry } from '../../shared/constants/industry-modules.constant';

export interface PanelUISettings {
  STORE_ADMIN?: Record<string, boolean>;
  STORE_ECOMMERCE?: Record<string, boolean>;
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
  fiscal_status?: FiscalStatusBlock;
  panel_ui?: PanelUISettings;
}

export interface AppSettings {
  name: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  theme: 'default' | 'aura' | 'monocromo';
  logo_url: string | null;
  favicon_url: string | null;
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
  /**
   * Store industry classification (multi-select). Mirrors `stores.industries`
   * on the backend. Default `['retail']` for existing tenants.
   */
  industries?: StoreIndustry[];
}

export type InventoryScope = 'main_location' | 'all_locations';

export interface InventorySettings {
  low_stock_threshold: number;
  out_of_stock_action: 'hide' | 'show' | 'disable' | 'allow_backorder';
  track_inventory: boolean;
  allow_negative_stock: boolean;
  costing_method: 'cpp' | 'fifo';
  /**
   * Scope used by POS when looking up stock for sale.
   * - `main_location`: POS only consumes stock from the store's main location.
   * - `all_locations`: POS may consume stock from any active location of the store.
   * Default: `main_location`.
   */
  pos_stock_scope: InventoryScope;
  /**
   * Scope used by low-stock alert evaluation.
   * - `main_location`: alerts only consider stock at the main location.
   * - `all_locations`: alerts aggregate stock across all active locations.
   * Default: `main_location`.
   */
  low_stock_alerts_scope: InventoryScope;
}

export interface OperationsSettings {
  default_preparation_time_minutes: number;
  /**
   * Hour (0–23) at which the KDS board clears and resets the day's tickets.
   * Mirrors backend `operations.ticket_closing_hour`. Default 3 (3 AM).
   */
  ticket_closing_hour?: number;
}

/**
 * When an order is dispatched on a route, controls when its state advances to
 * "delivered".
 * - `live`: the order is marked delivered as soon as each route stop is settled.
 * - `on_close`: the order only advances when the route sheet is closed/settled
 *   (current behavior).
 * Mirrors backend `store_settings.settings.dispatch.order_state_update_mode`.
 * Default `on_close`.
 */
export type OrderStateUpdateMode = 'live' | 'on_close';

export interface DispatchSettings {
  order_state_update_mode: OrderStateUpdateMode;
}

/**
 * Restaurant-specific store settings. Only relevant when the store's
 * `general.industries` includes `'restaurant'`. Mirrors backend
 * `store_settings.settings.restaurant`.
 */
export type QrScanBehavior = 'menu_only' | 'mark_occupied' | 'open_tab' | 'require_staff';

export interface RestaurantSettings {
  /**
   * When `true`, the table view exposes a checkout action so the bill can be
   * settled directly from the table. When `false`, the table view only shows
   * the payment status. Default `false`.
   */
  enable_table_checkout: boolean;
  /**
   * Behavior when a customer scans a table QR code.
   * - `menu_only`: show the digital menu only (no table state change).
   * - `mark_occupied`: mark the table as occupied.
   * - `open_tab`: mark occupied and open a running tab/order.
   * - `require_staff`: notify a waiter; no automatic state change.
   * Default `menu_only`.
   */
  qr_scan_behavior?: QrScanBehavior;
  /**
   * When `true`, scanning the QR auto-fires the order items to the kitchen
   * (KDS) without waiter intervention. Default `false`.
   */
  qr_auto_fire?: boolean;
}

/**
 * Membership/gym-specific store settings. Only relevant when the store's
 * `general.industries` includes `'gym'`. Mirrors backend
 * `store_settings.settings.membership`.
 */
export interface MembershipSettings {
  /**
   * When `true`, enables ambient (background) access validation for gym
   * memberships. When `false` (default), ambient access validation is off.
   */
  ambient_access_enabled: boolean;
  /**
   * When `true`, enables capacity (aforo) control for the membership area.
   * When `false` (default), capacity control is disabled.
   */
  capacity_control_enabled?: boolean;
  /**
   * Maximum number of people allowed inside (aforo máximo). Default `0`.
   */
  max_capacity?: number;
  /**
   * When `true`, a turnstile controls entries/exits and automatic leveling is
   * disabled. Default `false`.
   */
  turnstile_mode?: boolean;
  /**
   * When `true`, enables automatic capacity leveling (time-based decrement of
   * the occupancy count). Default `false`.
   */
  auto_leveling_enabled?: boolean;
  /**
   * Interval in hours after which automatic leveling decrements the occupancy
   * count by 1 person. Allowed values: `1` or `2`. Default `2`.
   */
  auto_leveling_interval_hours?: number;
  /**
   * Configuration for the fingerprint reader device used for ambient access.
   * Mirrors backend `store_settings.settings.membership.fingerprint_device`.
   * Default: `{ reader_type: 'id_wrapper' }`.
   */
  fingerprint_device?: FingerprintDeviceConfig;
  /**
   * When `true`, the QR scanner runs in kiosk mode: it auto-opens on the Aforo
   * tab and stays on in a continuous decode loop (for a fixed reception tablet).
   * When `false` (default), the scanner is opened manually and closes after each
   * scan. Mirrors backend `store_settings.settings.membership.qr_kiosk_mode`.
   */
  qr_kiosk_mode?: boolean;
  /**
   * Default display mode for the Aforo QR scanner. `fullscreen` (default) or
   * `floating` (movable window/bubble). Mirrors backend
   * `store_settings.settings.membership.qr_scanner_default_mode`. Per-device
   * position/size/mode overrides live in localStorage.
   */
  qr_scanner_default_mode?: 'fullscreen' | 'floating';
}

/**
 * Fingerprint reader device configuration.
 * - `id_wrapper` (Tipo A): the reader emits an ID directly. No adapter needed.
 * - `template_sdk` (Tipo B): the reader sends a template/image to an SDK /
 *   adapter that resolves the member ID.
 * Mirrors backend `FingerprintDeviceConfig` in store-settings.interface.ts.
 */
export interface FingerprintDeviceConfig {
  reader_type: 'id_wrapper' | 'template_sdk';
  sdk_provider?: 'zkteco' | 'digitalpersona' | 'generic_http';
  /** URL of the SDK/adapter endpoint for `template_sdk`. */
  endpoint?: string;
  /** Reference to the API key (never the key itself). */
  api_key_ref?: string;
  /** Capture/SDK timeout in milliseconds. */
  timeout_ms?: number;
  /** Verify timeout in milliseconds. */
  verify_timeout_ms?: number;
}

export interface CheckoutSettings {
  require_customer_data: boolean;
  allow_guest_checkout: boolean;
  allow_partial_payments: boolean;
  require_payment_confirmation: boolean;
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

export interface PosSettings {
  allow_anonymous_sales: boolean;
  anonymous_sales_as_default: boolean;
  business_hours: Record<string, BusinessHours>;
  schedule_mode?: 'continuous' | 'custom';
  enable_schedule_validation: boolean;
  show_onscreen_keypad: boolean;
  auto_print_receipt: boolean;
  allow_price_edit: boolean;
  allow_discount: boolean;
  max_discount_percentage: number;
  allow_refund_without_approval: boolean;
  scale?: ScaleSettings;
  cash_register?: CashRegisterSettings;
  barcode_scanner?: BarcodeScannerSettings;
  customer_queue?: CustomerQueueSettings;
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
  device?: ScaleDeviceConfig;
}

export interface ScaleDeviceConfig {
  baud_rate: number;
  data_bits: 7 | 8;
  stop_bits: 1 | 2;
  parity: 'none' | 'even' | 'odd';
  protocol: 'generic' | 'cas' | 'ohaus';
}

export type ScaleConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface ReceiptsSettings {
  print_receipt: boolean;
  email_receipt: boolean;
  receipt_header: string;
  receipt_footer: string;
}

export interface BusinessHoursBlock {
  open: string;
  close: string;
}

export interface BusinessHours {
  open: string;
  close: string;
  blocks?: BusinessHoursBlock[];
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}
