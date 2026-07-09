import type { FiscalStatusBlock } from '@common/interfaces/fiscal-status.interface';
import type { StoreIndustry } from '../../stores/dto/index';

// ============================================================================
// FISCAL DATA - Legal/tax identity of the store (NIT, regime, address, etc.)
// ============================================================================
export interface FiscalDataSettings {
  nit?: string;
  nit_dv?: string;
  tax_id?: string;
  tax_id_dv?: string;
  nit_type?: 'NIT' | 'CC' | 'CE' | 'TI' | 'PP' | 'NIT_EXTRANJERIA';
  legal_name?: string;
  person_type?: 'NATURAL' | 'JURIDICA';
  tax_regime?: 'COMUN' | 'SIMPLIFICADO' | 'GRAN_CONTRIBUYENTE';
  ciiu?: string;
  fiscal_address?: string;
  country?: string;
  department?: string;
  city?: string;
  tax_responsibilities?: string[];
  // IVA declaration periodicity (art. 600 ET). Only meaningful when the
  // tenant is responsable de IVA (O-48). Absent ⇒ defaults to 'bimonthly'.
  vat_periodicity?: 'monthly' | 'bimonthly' | 'four_monthly';
  // DIAN issuer tax scheme code ('O-13' Gran Contribuyente, 'O-15'
  // Autorretenedor, 'R-99-PN', etc.). Currently hardcoded in the DIAN
  // provider; captured here for the pending provider-wiring follow-up.
  tax_scheme?: string;
  // Withholding (retención) role flags. Absent ⇒ treated as false.
  // is_withholding_agent: tenant retains on purchases (Caso 1, retenedor).
  // is_self_withholder: tenant may be subject to being withheld (Caso 2, autorretenedor).
  is_withholding_agent?: boolean;
  is_self_withholder?: boolean;
  // ICA location (Colombia). Mirrors the real columns `stores.municipality_code`
  // / `stores.ciiu_code` (read/write symmetry with getFiscalData/updateFiscalData
  // and with tax-declaration-draft.service.ts:calculateIca).
  municipality_code?: string;
  ciiu_code?: string;
}

// ============================================================================
// BRANDING - Única fuente de verdad para colores, logo y theming
// ============================================================================
export interface BrandingSettings {
  name: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  background_color: string;
  surface_color: string;
  text_color: string;
  text_secondary_color: string;
  text_muted_color: string;
  logo_url?: string;
  favicon_url?: string;
  custom_css?: string;
}

// ============================================================================
// FONTS - Configuración de fuentes
// ============================================================================
export interface FontsSettings {
  primary: string;
  secondary: string;
  headings: string;
}

// ============================================================================
// PUBLICATION - Estado de publicación de la tienda
// ============================================================================
export interface PublicationSettings {
  store_published: boolean;
  ecommerce_enabled: boolean;
  landing_enabled: boolean;
  maintenance_mode: boolean;
  maintenance_message?: string;
  allow_public_access: boolean;
}

// ============================================================================
// ECOMMERCE - Configuración del ecommerce (movido desde domain.config)
// ============================================================================
export interface EcommerceSliderPhoto {
  url?: string;
  key?: string;
  title?: string;
  caption?: string;
  action_type?: 'none' | 'internal_url' | 'external_url' | 'product' | 'category' | 'brand';
  action_label?: string;
  action_url?: string;
  product_id?: number;
  category_id?: number;
  brand_id?: number;
  open_in_new_tab?: boolean;
}

export interface EcommerceHomeSectionSettings {
  enabled?: boolean;
  title?: string;
  subtitle?: string;
  limit?: number;
  sort_order?: number;
}

export interface EcommerceHomeSectionsSettings {
  slider?: EcommerceHomeSectionSettings;
  welcome?: EcommerceHomeSectionSettings;
  categories?: EcommerceHomeSectionSettings;
  brands?: EcommerceHomeSectionSettings;
  featured_products?: EcommerceHomeSectionSettings;
}

export interface EcommerceSettings {
  enabled: boolean;
  general?: {
    currency?: string;
    locale?: string;
    timezone?: string;
    qr_code_url?: string;
    qr_code_data_url?: string;
    qr_code_generated_at?: string;
  };
  slider?: {
    enable: boolean;
    photos: EcommerceSliderPhoto[];
  };
  home_sections?: EcommerceHomeSectionsSettings;
  inicio?: {
    titulo?: string;
    parrafo?: string;
    logo_url?: string;
    favicon_url?: string;
    // Legacy: colores para compatibilidad (migrar a branding)
    colores?: {
      primary_color: string;
      secondary_color: string;
      accent_color: string;
    };
  };
  catalog?: {
    products_per_page: number;
    show_out_of_stock: boolean;
    allow_reviews: boolean;
    show_variants: boolean;
    show_related_products: boolean;
    enable_filters: boolean;
  };
  cart?: {
    allow_guest_checkout: boolean;
    cart_expiration_hours: number;
    max_quantity_per_item: number;
    save_for_later: boolean;
  };
  checkout?: {
    require_registration: boolean;
    guest_email_required: boolean;
    create_account_after_order: boolean;
    terms_required: boolean;
    guest_newsletter_opt_in: boolean;
  };
  shipping?: {
    free_shipping_threshold?: number;
    calculate_tax_before_shipping: boolean;
    multiple_shipping_addresses: boolean;
  };
  footer?: FooterSettings;
}

// ============================================================================
// FOOTER - Configuración del pie de página del ecommerce
// ============================================================================
export interface FooterStoreInfo {
  about_us?: string;
  support_email?: string;
  tagline?: string;
}

export interface FooterLink {
  label: string;
  url: string;
  is_external?: boolean;
}

export interface FooterFaqItem {
  question: string;
  answer: string;
}

export interface FooterHelp {
  faq?: FooterFaqItem[];
  shipping_info?: string;
  returns_info?: string;
}

export interface FooterSocialAccount {
  username?: string;
  url?: string;
}

export interface FooterSocial {
  facebook?: FooterSocialAccount;
  instagram?: FooterSocialAccount;
  tiktok?: FooterSocialAccount;
}

export interface FooterSettings {
  store_info?: FooterStoreInfo;
  links?: FooterLink[];
  help?: FooterHelp;
  social?: FooterSocial;
}

// Legacy: Mantener por compatibilidad temporal
export interface AppSettings {
  name: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  theme: 'default' | 'aura' | 'monocromo';
  logo_url?: string;
  favicon_url?: string;
}

// ============================================================================
// PANEL UI - Control de módulos disponibles a nivel de tienda
// ============================================================================
export interface PanelUISettings {
  STORE_ADMIN?: Record<string, boolean>;
  STORE_ECOMMERCE?: Record<string, boolean>;
}

// ============================================================================
// ACCOUNTING FLOWS - Controls which flows generate auto-entries
// ============================================================================
export interface AccountingFlowsSettings {
  invoicing: boolean;
  payments: boolean;
  expenses: boolean;
  payroll: boolean;
  credit_sales: boolean;
  inventory: boolean;
  returns: boolean;
  purchases: boolean;
  layaway: boolean;
  fixed_assets: boolean;
  withholding: boolean;
  settlements: boolean;
  wallet: boolean;
  cash_register: boolean;
  stock_transfers: boolean;
  commissions: boolean;
  ar_ap: boolean;
  installments: boolean;
}

// ============================================================================
// MODULE FLOWS - Master toggles + per-module flow settings
// ============================================================================
export interface AccountingModuleFlows {
  enabled: boolean;
  invoicing: boolean;
  payments: boolean;
  expenses: boolean;
  payroll: boolean;
  credit_sales: boolean;
  inventory: boolean;
  returns: boolean;
  purchases: boolean;
  layaway: boolean;
  fixed_assets: boolean;
  withholding: boolean;
  settlements: boolean;
  wallet: boolean;
  cash_register: boolean;
  stock_transfers: boolean;
  commissions: boolean;
  ar_ap: boolean;
  installments: boolean;
}

export interface PayrollModuleFlows {
  enabled: boolean;
}

export interface InvoicingModuleFlows {
  enabled: boolean;
}

export interface ModuleFlowsSettings {
  accounting: AccountingModuleFlows;
  payroll: PayrollModuleFlows;
  invoicing: InvoicingModuleFlows;
}

export interface StoreSettings {
  /**
   * Internal schema version for migrations. See `SettingsMigratorService`.
   * Stamped on every persist. Optional on read for legacy rows.
   */
  _schema_version?: number;

  // NUEVAS SECCIONES - Única fuente de verdad
  branding: BrandingSettings;
  fonts: FontsSettings;
  publication: PublicationSettings;
  ecommerce?: EcommerceSettings;

  // Panel UI - Control de módulos disponibles a nivel de tienda
  panel_ui?: PanelUISettings;

  /** @deprecated Use module_flows.accounting instead */
  accounting_flows?: AccountingFlowsSettings;

  // Module flows - Master toggles + per-module flow settings
  module_flows?: ModuleFlowsSettings;

  // Fiscal status - semantic fiscal responsibility switches
  fiscal_status?: FiscalStatusBlock;

  // Fiscal data - legal/tax identity (NIT, regime, address, responsibilities)
  fiscal_data?: FiscalDataSettings;

  // Reservations - Booking reminders, confirmation, and check-in
  reservations?: ReservationsSettings;

  // Availability - Slot generation behavior for fallback schedule
  availability?: AvailabilitySettings;

  // Operations - Preparation and delivery defaults
  operations?: OperationsSettings;

  // Dispatch - DSD route / dispatch behavior toggles
  dispatch?: DispatchSettings;

  // Restaurant - restaurant suite behavior toggles
  restaurant?: RestaurantSettings;

  // Membership - gym/membership suite behavior toggles
  membership?: MembershipSettings;

  // Secciones existentes
  general: GeneralSettings;
  inventory: InventorySettings;
  checkout: CheckoutSettings;
  notifications: NotificationsSettings;
  pos: PosSettings;
  receipts: ReceiptsSettings;

  // Legacy: Mantener por compatibilidad temporal (redundante con branding)
  app?: AppSettings;
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
   * - `main_location`: POS only consumes stock from `stores.default_location_id`.
   * - `all_locations`: POS may consume stock from any active location of the store.
   * Default: `main_location`.
   */
  pos_stock_scope: InventoryScope;
  /**
   * Scope used by low-stock alert evaluation.
   * - `main_location`: alerts only consider stock at `stores.default_location_id`.
   * - `all_locations`: alerts aggregate stock across all active locations.
   * Default: `main_location`.
   */
  low_stock_alerts_scope: InventoryScope;
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

export interface CustomerQueueSettings {
  enabled: boolean;
  queue_expiry_hours: number;
  max_queue_size: number;
  require_email: boolean;
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
  offline_mode_enabled: boolean;
  auto_print_receipt: boolean;
  allow_price_edit: boolean;
  allow_discount: boolean;
  max_discount_percentage: number;
  allow_refund_without_approval: boolean;
  scale?: ScaleSettings;
  cash_register?: CashRegisterSettings;
  barcode_scanner?: BarcodeScannerSettings;
  default_payment_form?: 'contado' | 'credito';
  show_onscreen_keypad: boolean;
  customer_queue?: CustomerQueueSettings;
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

// ============================================================================
// RESERVATIONS - Booking reminders, confirmation, and check-in settings
// ============================================================================
export interface BookingReminderRule {
  time_before: string; // '30m' | '1h' | '2h' | '24h' | '48h' | '1w'
  channels: ('email' | 'push' | 'whatsapp' | 'in_app')[];
  enabled: boolean;
}

export interface BookingConfirmationSettings {
  enabled: boolean;
  send_at: string;
  channels: ('email' | 'push' | 'whatsapp')[];
  auto_cancel_if_unconfirmed: boolean;
  cancel_after: string;
}

export interface BookingCheckInSettings {
  enabled: boolean;
  allow_customer_check_in: boolean;
  allow_staff_check_in: boolean;
  notify_provider_on_check_in: boolean;
}

export interface ReservationsSettings {
  reminders: BookingReminderRule[];
  confirmation: BookingConfirmationSettings;
  check_in: BookingCheckInSettings;
}

// ============================================================================
// AVAILABILITY - Slot generation behavior when no provider schedule exists
// ============================================================================
export interface AvailabilitySettings {
  /**
   * Days of the week on which the store wants generic slot generation to
   * produce slots. ISO-ish: 0=Sunday, 1=Monday, ..., 6=Saturday. Default
   * is Mon-Fri (1-5) — matches the historic hardcoded behavior in
   * `AvailabilityService.generateGenericSlots` (which used to skip both
   * Saturday and Sunday). Stores that open on weekends should add `0`
   * and/or `6` to override.
   *
   * Used only as a fallback by `generateGenericSlots` when no
   * `provider_schedules` row covers the date. Per-provider schedules
   * remain the source of truth when they exist.
   */
  working_days: number[];
}

export interface OperationsSettings {
  default_preparation_time_minutes: number;
  ticket_closing_hour?: number;
}

// ============================================================================
// RESTAURANT - Restaurant suite behavior toggles
// ============================================================================
export interface RestaurantSettings {
  /**
   * Enables paying/closing a table check directly from the table screen
   * (table checkout). When false (default), the check is only paid via
   * the normal POS payment flow.
   */
  enable_table_checkout: boolean;
}

export interface FingerprintDeviceConfig {
  /**
   * Reader integration mode for fingerprint access validation.
   * - `id_wrapper` (Tipo A, default): the reader emits an opaque ID directly;
   *   Vendix stores/looks up credentials as `external_ref` and never sees
   *   the biometric template.
   * - `template_sdk` (Tipo B, plan only): the reader ships a template/image
   *   to a configured SDK provider that returns an opaque ID. The endpoint
   *   and SDK are NOT implemented yet — see plan anotación 3c.
   */
  reader_type: 'id_wrapper' | 'template_sdk';
  /**
   * SDK provider to delegate fingerprint template processing to.
   * Only relevant when `reader_type === 'template_sdk'`.
   */
  sdk_provider?: 'zkteco' | 'digitalpersona' | 'generic_http';
  /**
   * URL of the SDK adapter for `template_sdk` mode (HTTP endpoint for
   * `generic_http`, or vendor-specific host for `zkteco`/`digitalpersona`).
   */
  endpoint?: string;
  /**
   * Reference to an API key (NOT the key itself) used to authenticate
   * against the configured SDK endpoint. Secrets are resolved via the
   * settings secrets store; the reference identifies the entry.
   */
  api_key_ref?: string;
  /** Request timeout in milliseconds when calling the SDK. */
  timeout_ms?: number;
  /** Per-verification timeout in milliseconds (latency cap per check). */
  verify_timeout_ms?: number;
}

export interface MembershipSettings {
  /**
   * Enables ambient (background) access validation for gym memberships.
   * Only relevant when the store's `general.industries` includes `'gym'`.
   * When false (default), ambient access validation is disabled.
   */
  ambient_access_enabled: boolean;
  /**
   * Enables capacity (aforo) control for the membership area.
   * When false (default), capacity control is disabled.
   */
  capacity_control_enabled?: boolean;
  /**
   * Maximum number of people allowed inside (aforo máximo).
   * Default `0`.
   */
  max_capacity?: number;
  /**
   * When true, a turnstile controls entries/exits and automatic leveling is
   * disabled. Default `false`.
   */
  turnstile_mode?: boolean;
  /**
   * Enables automatic capacity leveling (time-based decrement of the
   * occupancy count). Default `false`.
   */
  auto_leveling_enabled?: boolean;
  /**
   * Interval in hours after which automatic leveling decrements the occupancy
   * count by 1 person. Allowed values: `1` or `2`. Default `2`.
   */
  auto_leveling_interval_hours?: number;
  /**
   * Fingerprint reader device configuration for access validation.
   * Default (`reader_type: 'id_wrapper'`) preserves the current behavior
   * where the reader emits an opaque ID and Vendix never sees the template.
   */
  fingerprint_device?: FingerprintDeviceConfig;
}

// ============================================================================
// DISPATCH - DSD route / dispatch behavior toggles
// ============================================================================
export interface DispatchSettings {
  /**
   * How a COD order's state is advanced while settling a dispatch route.
   * - `live`: the linked order reflects `delivered` in real time when each
   *   stop is settled with result `delivered`/`partial` (during settleStop).
   * - `on_close`: the order advances `shipped → delivered → finished` only when
   *   the route is closed (legacy/default behavior).
   * Default: `on_close`.
   */
  order_state_update_mode?: 'live' | 'on_close';
}
