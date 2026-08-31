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
  carrier?: CarrierSettings;
  fiscal_status?: FiscalStatusBlock;
  panel_ui?: PanelUISettings;
  /**
   * Services sub-section (offer_home_service + local_address). Lives
   * outside the top-level sections in the backend JSON. Mirrors
   * `store_settings.settings.services.*` on the backend.
   */
  services?: any;
  /**
   * Reservations sub-section (reminders, confirmation, check_in, and
   * the operator-facing `allow_direct_reschedule` toggle). Mirrors
   * `store_settings.settings.reservations.*` on the backend.
   *
   * Optional because the backend migrator materializes the defaults
   * lazily — stores that never edited `reservations` may not have it
   * persisted. Read paths should fall back to the
   * `DEFAULT_ALLOW_DIRECT_RESCHEDULE` constant.
   */
  reservations?: ReservationsSettings;
  /**
   * Master switch for the Vexi assistant. Mirrors backend `VexiSettings`.
   *
   * Optional because a store only carries this block once somebody turned Vexi
   * on: the assistant ships off and is enabled per store. Absent means
   * disabled — read it through `StoreSettingsFacade.vexiEnabled()`, never as
   * `settings.vexi!.enabled`.
   */
  vexi?: VexiSettings;

  /**
   * Parámetros de emisión fiscal que la ley deja al contribuyente. Espejo de
   * `InvoicingSettingsDto` en
   * `apps/backend/src/domains/store/settings/dto/settings-schemas.dto.ts`.
   *
   * Opcional porque una tienda sólo lleva este bloque una vez que alguien
   * configuró la pantalla: ausente significa "todo por defecto", no "apagado".
   * Leer siempre con fallback a `AIU_SETTINGS_DEFAULTS`.
   */
  invoicing?: InvoicingSettings;

  /**
   * Reglas del motor de promociones y descuentos.
   * Permite elegir entre 'winner_takes_all' y 'stacking_groups', topes de margen y visibilidad de promociones.
   */
  promotions?: PromotionsSettings;
}

export interface PromotionsSettings {
  evaluation_strategy?: 'winner_takes_all' | 'stacking_groups';
  max_combined_discount_percentage?: number;
  allow_order_promo_stacking?: boolean;
  exclude_tier_priced_lines?: boolean;
  enable_high_conversion_ui?: boolean;
}

/**
 * Master switch for the Vexi assistant. Mirrors backend `VexiSettings` in
 * `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts`.
 */
export interface VexiSettings {
  /**
   * Opcional, igual que en el DTO del backend (`VexiSettingsDto.enabled?`).
   *
   * `Partial<StoreSettings>` es superficial: hace opcional la sección `vexi`,
   * pero no sus campos. Con `enabled` requerido, un PATCH que sólo quiere mover
   * el motor de voz estaba obligado a reenviar `enabled`, y reenviar un valor
   * que no se está editando es cómo se sobreescribe por accidente el cambio que
   * otra pestaña acaba de hacer. Ausente significa apagado — leer siempre por
   * `StoreSettingsFacade.vexiEnabled()`, que compara contra `=== true`.
   */
  enabled?: boolean;

  /**
   * Which engine answers a voice turn: `realtime` (WebRTC speech-to-speech) or
   * `pipeline` (transcribe → the chat's text agent → dictate).
   *
   * Read it through `StoreSettingsFacade.vexiVoiceEngine()`, which defaults an
   * absent value to `pipeline` — never as `settings.vexi!.voice_engine`, or a
   * store that predates the key routes the gesture nowhere.
   *
   * Sólo el pipeline puede ejecutar escrituras con confirmación, porque es el
   * único que pasa por la tarjeta de aprobación del panel.
   */
  voice_engine?: 'realtime' | 'pipeline';
}

/**
 * Régimen de IVA de un contrato AIU. Espejo de `AiuSettingsDto.regime` en el
 * backend.
 *
 * Los dos existen en la ley y ninguno es "el correcto": cuál aplica lo decide
 * el objeto del CONTRATO, no una preferencia del negocio.
 */
export type AiuRegime = 'et_462_1' | 'decreto_1372_1992';

/**
 * Parámetros AIU. Espejo de `AiuSettingsDto`
 * (`apps/backend/src/domains/store/settings/dto/settings-schemas.dto.ts`).
 *
 * Todos los campos son opcionales igual que en el DTO: el backend mezcla la
 * sección `invoicing.aiu` POR CLAVE, así que un PATCH parcial es válido y es
 * la forma correcta de guardar — reenviar un valor que no se está editando es
 * cómo se sobreescribe por accidente lo que otra pantalla acaba de cambiar.
 */
export interface AiuSettings {
  regime?: AiuRegime;
  contract_object?: string;
  enforce_minimum_base?: boolean;
  minimum_base_percent?: number;
}

/**
 * Qué hace el carril POS cuando la DIAN no acepta el documento. Espejo de
 * `PosDianFailurePolicy`
 * (`apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts`).
 *
 * No existe un valor `'block'` y no debe añadirse aquí: el evento
 * `pos.sale.completed` se emite DESPUÉS de confirmar el cobro, así que cuando
 * esta política se lee ya no queda venta que bloquear.
 */
export type PosDianFailurePolicy = 'queue' | 'ignore';

/**
 * Comportamiento del carril fiscal del POS. Espejo de `PosInvoicingSettings`
 * del backend. Igual que AIU, el backend mezcla `invoicing.pos` POR CLAVE:
 * mandar sólo el campo que se edita es lo correcto.
 */
export interface PosInvoicingSettings {
  auto_emit?: boolean;
  on_failure?: PosDianFailurePolicy;
}

export interface InvoicingSettings {
  aiu?: AiuSettings;
  pos?: PosInvoicingSettings;
}

/**
 * Los mismos defaults que asume el backend (`DEFAULT_POS_AUTO_EMIT` y
 * `DEFAULT_POS_DIAN_FAILURE_POLICY`). `'queue'` es el conservador: es el único
 * que deja constancia consultable del fallo.
 */
export const POS_INVOICING_SETTINGS_DEFAULTS: Required<PosInvoicingSettings> = {
  auto_emit: true,
  on_failure: 'queue',
};

/**
 * Valores que asume el backend cuando la tienda nunca configuró la sección.
 *
 * `et_462_1` es el default conservador a propósito: declara MÁS IVA, y pagar de
 * más se recupera mientras que declarar de menos es sanción.
 */
export const AIU_SETTINGS_DEFAULTS: Required<AiuSettings> = {
  regime: 'et_462_1',
  contract_object: '',
  enforce_minimum_base: true,
  minimum_base_percent: 10,
};

/**
 * Reservations policy. Mirrors backend `ReservationsSettings` in
 * `store-settings.interface.ts`.
 */
export interface ReservationsSettings {
  /** When true (default), customers reschedule with 1 click. When false,
   *  the reschedule becomes a pending request routed through the
   *  `booking_reschedule_requests` admin queue. */
  allow_direct_reschedule: boolean;
  /** When true (default), the POS cashier can persist a `bookings`
   *  row for a service line on a draft order (Guardar) — the cart
   *  fires POST /api/store/reservations right after the order is
   *  created so the slot is locked before payment. When false, the
   *  POS does NOT create the booking on Guardar; the booking is
   *  attached later on the Cobrar path via the editor atomic block.
   *  This lets stores decide whether scheduling is gated by payment
   *  (false) or independent (true). */
  allow_bookings_without_payment: boolean;
}

/**
 * Carrier (Vendix Repartos) store settings. Mirrors backend
 * `store_settings.settings.carrier`. Holds the store-wide default delivery
 * tariff applied to carriers without a per-user tariff of their own.
 */
export type CarrierTariffMode = 'per_stop' | 'per_route';

export interface CarrierDefaultTariff {
  /** `per_stop`: paid per delivered stop. `per_route`: flat per closed route. */
  mode: CarrierTariffMode;
  /** Decimal string (never a float), e.g. "1500.00". */
  amount: string;
  /** Fixed to 'COP' by the backend in v1. */
  currency?: string;
}

export interface CarrierSettings {
  default_tariff: CarrierDefaultTariff;
}

export interface AppSettings {
  name: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  // Espejo del contrato de branding del backend (settings-schemas.dto.ts).
  // Debe incluir los 4 presets del eje estilo; ver ThemePreset en
  // tenant-config.interface.ts.
  theme: 'default' | 'aura' | 'glass' | 'monocromo';
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
  /**
   * Re-entry detection mode: what happens when a member who already entered
   * recently scans again within `re_entry_window_hours`.
   * - `off`: no re-entry handling (always a normal grant).
   * - `warn` (default): entry is GRANTED but flagged (`warning: true`) so the
   *   operator is alerted.
   * - `block`: entry is DENIED with `denied_re_entry`.
   * Mirrors backend `store_settings.settings.membership.re_entry_mode`.
   */
  re_entry_mode?: 'off' | 'warn' | 'block';
  /**
   * Window (in hours) during which a repeated entry counts as a re-entry.
   * Default `2`. Mirrors backend
   * `store_settings.settings.membership.re_entry_window_hours`.
   */
  re_entry_window_hours?: number;
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

/**
 * Mirror of the backend `PRINT_FORMATS` (store-settings.interface.ts). Closed
 * set on purpose: the invoice's graphic representation carries mandatory content
 * (issuer legal data, CUFE, QR), so the format changes the box, never the
 * contents. `thermal_*` are roll widths in millimetres.
 */
export const PRINT_FORMATS = [
  'letter',
  'half_letter',
  'a4',
  'thermal_80',
  'thermal_58',
] as const;

export type PrintFormat = (typeof PRINT_FORMATS)[number];

/** Human labels for the selectors, kept next to the list so they cannot drift. */
export const PRINT_FORMAT_LABELS: Record<PrintFormat, string> = {
  letter: 'Carta (216 × 279 mm)',
  half_letter: 'Media carta (216 × 140 mm)',
  a4: 'A4 (210 × 297 mm)',
  thermal_80: 'Rollo térmico 80 mm',
  thermal_58: 'Rollo térmico 58 mm',
};

/**
 * Mirror of the backend `PRINT_DOCUMENTS`. Every document the application can
 * print, as its own configurable unit: the configurable unit is the store × the
 * document type, not the store alone.
 */
export const PRINT_DOCUMENTS = [
  'pos_ticket',
  'invoice',
  'dispatch_ticket',
  'dispatch_note',
  'dispatch_route',
  'sales_order',
  'purchase_order',
  'quotation',
  'reservation',
  'layaway',
  'guest_order',
  'withholding_certificate',
] as const;

export type PrintDocument = (typeof PRINT_DOCUMENTS)[number];

/** Human labels for the per-document rows of the print settings screen. */
export const PRINT_DOCUMENT_LABELS: Record<PrintDocument, string> = {
  pos_ticket: 'Tiquete POS',
  invoice: 'Factura electrónica',
  dispatch_ticket: 'Tiquete de despacho',
  dispatch_note: 'Remisión',
  dispatch_route: 'Planilla de ruta',
  sales_order: 'Orden de venta',
  purchase_order: 'Orden de compra',
  quotation: 'Cotización',
  reservation: 'Reserva',
  layaway: 'Separado',
  guest_order: 'Pedido de invitado',
  withholding_certificate: 'Certificado de retención',
};

export interface PrintDocumentConfig {
  format: PrintFormat;
  /** Page margin in millimetres. Ignored on roll formats. */
  margin_mm?: number;
  /** Printed copies. 0 = do not print. */
  copies?: number;
}

/**
 * Per-store, per-document print configuration. Scope is the STORE: nothing is
 * inherited from the organization. Absent entries fall back to
 * `PRINT_DEFAULTS`.
 */
export type PrintingSettings = Partial<
  Record<PrintDocument, PrintDocumentConfig>
>;

/**
 * Mirror of the backend `PRINT_DEFAULTS`, taken from what the desktop build
 * already does so a store that never opens this screen keeps printing as before.
 */
export const PRINT_DEFAULTS: Record<PrintDocument, PrintDocumentConfig> = {
  pos_ticket: { format: 'thermal_80', copies: 1 },
  invoice: { format: 'thermal_80', copies: 1 },
  dispatch_ticket: { format: 'thermal_80', copies: 1 },
  dispatch_note: { format: 'a4', margin_mm: 20, copies: 1 },
  dispatch_route: { format: 'a4', margin_mm: 8, copies: 1 },
  sales_order: { format: 'a4', margin_mm: 20, copies: 1 },
  purchase_order: { format: 'a4', margin_mm: 20, copies: 1 },
  quotation: { format: 'a4', margin_mm: 20, copies: 1 },
  reservation: { format: 'a4', margin_mm: 20, copies: 1 },
  layaway: { format: 'a4', margin_mm: 20, copies: 1 },
  guest_order: { format: 'a4', margin_mm: 20, copies: 1 },
  withholding_certificate: { format: 'a4', margin_mm: 20, copies: 1 },
};

/**
 * Page geometry per format. `page_size` is the CSS `@page size` rule; without it
 * the browser falls back to its own default and silently ignores the configured
 * paper.
 *
 * [print-editor-dsk P1.6] Re-exportado del shim local `app/core/lib/page-geometry`
 * para mantener sincronía byte-a-byte con backend y mobile. La fuente única es
 * `libs/print-formats/schemas/page-geometry.json` y el script
 * `scripts/sync-print-geometry.ts` la copia a cada app.
 */
export { PRINT_PAGE_GEOMETRY } from '../lib/page-geometry';

export interface ReceiptsSettings {
  print_receipt: boolean;
  email_receipt: boolean;
  receipt_header: string;
  receipt_footer: string;
  /**
   * Electronic-invoicing block, surfaced instead of the receipt toggles once the
   * store is actually issuing electronic invoices — i.e. its DIAN configuration
   * is `environment='production'` with `enablement_status='enabled'`, NOT merely
   * when the fiscal wizard was completed. Optional across the board for
   * backward compatibility with settings rows that predate the block.
   */
  /** Issue (and transmit) the electronic invoice right after the sale closes. */
  auto_issue_invoice?: boolean;
  /** Printed copies of the electronic invoice per sale. 0 = do not print. */
  invoice_copies?: number;
  /** Email the electronic invoice + its XML to the customer. */
  send_invoice_email?: boolean;
  /** Also print the POS ticket alongside the invoice (kitchen/warehouse copy). */
  print_pos_ticket?: boolean;
  /**
   * Handing the printed graphic representation to the buyer. Colombian law
   * requires the invoice to be DELIVERED to the acquirer, in physical or
   * electronic form — not specifically by email. Second lawful channel, so the
   * form keeps at least one of `send_invoice_email` / `deliver_printed` on.
   */
  deliver_printed?: boolean;
  /**
   * @deprecated Superseded by `printing.invoice`. Still LIVE: the backend reads
   * it in `invoice-pdf.service.ts` (`resolveInvoiceFormat`) and it defaults to
   * `letter`, so it governs what already-invoicing stores print today. The
   * settings screen mirrors `printing.invoice` into it while consumers migrate.
   */
  invoice_format?: PrintFormat;
  /**
   * @deprecated Superseded by `printing.pos_ticket`. Still honoured as a
   * fallback while stores are migrated.
   */
  pos_ticket_format?: PrintFormat;
  /** @deprecated Superseded by `printing.pos_ticket.copies`. */
  pos_ticket_copies?: number;
  /**
   * Per-document print configuration. Lives under `receipts` rather than as a
   * new top-level section: `KNOWN_SECTIONS` drops unknown sections while still
   * answering 200, so a new section would look saved and never persist.
   */
  printing?: PrintingSettings;
  /**
   * Habilita la impresión del tiquete de despacho (dispatch_ticket).
   * Si false, los 2 disparadores (POS auto + orden manual) NO imprimen.
   * ADR-7: flat bajo `receipts` raíz (no en `printing.dispatch_ticket`) para
   * evitar drop por KNOWN_SECTIONS.
   */
  print_dispatch_ticket_enabled?: boolean;
  /**
   * Si true y print_dispatch_ticket_enabled=true, el POS encadena auto el
   * tiquete de despacho junto con ticket POS/factura cuando la venta tiene envío.
   * Default false (opt-in por admin).
   */
  print_dispatch_ticket_auto_with_pos?: boolean;
  /**
   * QUI-727 (A.2) — Si true y print_dispatch_ticket_enabled=true, la
   * postventa encadena auto el tiquete de despacho al confirmar entrega/pago.
   * Default false (opt-in por admin).
   */
  print_dispatch_ticket_auto_on_postventa?: boolean;
  /**
   * Decisión del usuario 2026-08-31: habilita el tiquete de despacho
   * como tiquete de reclamo en ventas de mostrador (`direct_delivery`)
   * y para llevar (`pickup`). Enmienda a ADR-6; default false.
   */
  print_dispatch_ticket_on_counter?: boolean;
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
