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
  /**
   * CP-PURCHASE-TRANSPARENCY B.2 — origen DERIVADO de la responsabilidad y del
   * régimen que devuelve la lectura: `'store'` si la tienda los declaró,
   * `'organization'` si los heredó de su organización.
   *
   * Estrictamente de LECTURA. `updateFiscalData` los descarta antes de mezclar,
   * así que un formulario que haga GET y devuelva el objeto entero no puede
   * persistirlos ni convertir un valor heredado en uno propio por accidente.
   */
  tax_responsibilities_source?: 'store' | 'organization';
  tax_regime_source?: 'store' | 'organization';
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
  // Tri-estado: `undefined` = sin tocar, `null` = borrado, string = clave S3.
  logo_url?: string | null;
  favicon_url?: string | null;
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
  // Opt-in "Promociones activas" banner/section. Disabled by default so
  // existing storefronts do not surface it until the store enables it.
  promotions?: EcommerceHomeSectionSettings;
  // Restaurant menus (cartas) section — only honored when the store industry
  // includes "restaurant". Typing gap that mirrors the existing DTO field.
  menus?: EcommerceHomeSectionSettings;
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
    // Storefront checkout availability master switch. When explicitly `false`
    // the store rejects checkout (StoreAvailabilityGuard → ECOM_CHECKOUT_004).
    // Absent/`true` ⇒ checkout allowed (default `true`).
    store_available?: boolean;
    // Optional message shown to the customer when the store is unavailable.
    // If empty, PublicDomainsService computes a "next open" fallback message.
    unavailable_message?: string;
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
    // Opt-in: habilita el selector de presentación de venta (multi-tarifa
    // `price_tiers.kind='sale_unit'`) en la ficha de producto del storefront.
    // Ausente ⇒ apagado (default `false`); se lee con `=== true`.
    enable_sale_unit_selector: boolean;
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
  theme: 'default' | 'aura' | 'glass' | 'monocromo';
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

// ============================================================================
// INVOICING - Parámetros fiscales de emisión que la LEY deja al contribuyente
// ============================================================================

/**
 * Régimen de IVA aplicable a un contrato facturado bajo la modalidad AIU
 * (Administración, Imprevistos y Utilidad), `cbc:CustomizationID = '09'`.
 *
 * SON DOS RÉGIMENES CON BASES GRAVABLES DISTINTAS, Y CONFUNDIRLOS NO PRODUCE
 * NINGÚN ERROR VISIBLE. La DIAN acepta el documento en los dos casos: lo único
 * que cambia es cuánto IVA declara, y una factura que declaró de menos sólo se
 * corrige con nota crédito y reemisión. Por eso esto es una decisión EXPLÍCITA
 * del contribuyente y no algo que el motor deduzca de las líneas.
 *
 * · `et_462_1` — E.T. art. 462-1. Servicios de aseo y cafetería, vigilancia
 *   autorizada por la Supervigilancia, servicios temporales de empleo prestados
 *   por EST autorizadas, y cooperativas de trabajo asociado. La base gravable
 *   es el AIU **COMPLETO** (A + I + U) y, por mandato del mismo artículo, **no
 *   puede ser inferior al 10 % del valor del contrato**.
 *
 * · `decreto_1372_1992` — Decreto 1372/1992 art. 3. Contratos de construcción
 *   de bien inmueble. La base gravable es **ÚNICAMENTE la Utilidad** del
 *   constructor; administración e imprevistos quedan fuera del IVA.
 *
 * Cuál aplica depende del CONTRATO, no del producto ni del cliente: la misma
 * tienda podría, en teoría, tener contratos de los dos tipos. Por eso el valor
 * vive en la configuración de la tienda y el default es el conservador.
 */
export type AiuVatRegime = 'et_462_1' | 'decreto_1372_1992';

export interface AiuSettings {
  /**
   * Régimen aplicable. Default `et_462_1`, que es el CONSERVADOR: grava el AIU
   * completo, o sea declara MÁS IVA que el otro. Si el default estuviera
   * equivocado, el contribuyente pagó de más —recuperable— en vez de haber
   * declarado de menos ante la DIAN, que es sanción e intereses.
   */
  regime?: AiuVatRegime;
  /**
   * Objeto del contrato que se concatena al literal obligatorio
   * «Contrato de servicios AIU por concepto de: » en el `cbc:Note` de la línea
   * de ADMINISTRACIÓN (Anexo Técnico 1.9, regla CAV03).
   *
   * La regla exige entre 20 y 5000 caracteres CONTANDO el prefijo literal, así
   * que un objeto vacío no sirve: hay que describir el contrato.
   */
  contract_object?: string;
  /**
   * Aplica el piso legal del 10 % del valor del contrato sobre la base gravable
   * (E.T. art. 462-1). Default `true`. Sólo tiene sentido bajo `et_462_1`: el
   * Decreto 1372/1992 no fija piso alguno sobre la utilidad.
   *
   * No corrige la base en silencio — cuando el AIU declarado queda por debajo
   * del piso, la emisión se RECHAZA y se le dice al usuario cuánto falta.
   * Inflar la base automáticamente cambiaría el importe que el cliente firmó.
   */
  enforce_minimum_base?: boolean;
  /** Porcentaje del piso legal. Default 10. Configurable sólo por si la ley cambia. */
  minimum_base_percent?: number;
}

/**
 * Parámetros de emisión fiscal de la tienda.
 *
 * Escribible por `PATCH /store/settings`. Para que siga siéndolo, la sección
 * tiene que estar en LOS DOS sitios: `KNOWN_SECTIONS` (`settings.service.ts`) y
 * la propiedad `invoicing` de `UpdateSettingsDto` (tipada como
 * `InvoicingSettingsDto`). `sanitizeAndValidate` descarta toda clave de primer
 * nivel ausente de la lista y responde 200 igual, y el `ValidationPipe` corre
 * con `whitelist: true` y borra lo que el DTO no declare — así que quitar
 * cualquiera de las dos devuelve la sección al fallo silencioso que ya sufrieron
 * `vexi`, `availability` y `receipts.printing`.
 */
/**
 * Comportamiento fiscal del carril del POS.
 *
 * Lo único que separa la superficie del cajero de la del contador: qué pasa al
 * cerrar una venta de mostrador. Las reglas de validación y el documento que se
 * emite son los mismos en ambas — duplicarlas por superficie es cómo se llegó a
 * que el CUFE y el XML clasificaran impuestos distinto.
 */
/**
 * Qué hace el carril del POS con una venta que quedó SIN documento fiscal.
 *
 * ## Lo que NINGUNO de los dos valores hace: bloquear la venta
 *
 * No existe un valor `block`, y su ausencia es la decisión, no un olvido. El
 * evento `pos.sale.completed` se emite DESPUÉS del commit del cobro —el pedido,
 * el pago, el inventario y la caja ya están confirmados—, así que cuando esta
 * política se lee no queda nada que bloquear: la venta ocurrió. Ofrecer `block`
 * obligaría a mover la emisión DENTRO de la transacción del cobro, que es
 * exactamente lo que este carril existe para impedir: una caída de la DIAN
 * dejaría al cajero sin poder cobrar. Y su única alternativa —un modal que el
 * cajero tiene que cerrar para seguir vendiendo— es justo lo que el indicador
 * no modal descarta por diseño.
 *
 * Lo que sí varía, y es lo que estos dos valores eligen, es si el fallo QUEDA
 * REGISTRADO en un sitio que alguien pueda consultar después.
 */
export type PosDianFailurePolicy =
  /**
   * **Default.** El documento que no se pudo emitir queda anotado en
   * `invoice_retry_queue` con su motivo. Ahí lo ven el indicador del POS, el
   * listado de facturas (`retry_status`) y `getQueueStats()`, y desde ahí se
   * reintenta. Es el valor seguro porque es el único que cumple la regla que
   * de verdad importa: una venta cuya factura nunca se transmitió y de la que
   * nadie se entera es peor que un error en pantalla.
   */
  | 'queue'
  /**
   * El fallo se registra sólo en el log. Para la tienda que emite a mano desde
   * la superficie fiscal (`auto_emit: false`) y no quiere que cada borrador a
   * medio capturar aparezca como pendiente en la cola.
   */
  | 'ignore';

export interface PosInvoicingSettings {
  /**
   * Emitir el documento electrónico automáticamente al cerrar la venta.
   *
   * Default `true` (ver `DEFAULT_POS_AUTO_EMIT`). La emisión ocurre SIEMPRE
   * fuera de la transacción del cobro, así que apagarlo no hace la caja más
   * rápida: sólo obliga a pedir el documento a mano desde el POS.
   */
  auto_emit?: boolean;
  /**
   * Qué se hace con una venta de mostrador que quedó sin documento fiscal.
   * Default `'queue'` (ver `DEFAULT_POS_DIAN_FAILURE_POLICY`). NUNCA bloquea la
   * venta — ver `PosDianFailurePolicy` para por qué no existe ese valor.
   */
  on_failure?: PosDianFailurePolicy;
}

export interface InvoicingSettings {
  /** Régimen de IVA para contratos AIU (`operation_type = '09'`). */
  aiu?: AiuSettings;
  /** Comportamiento fiscal de la venta de mostrador. */
  pos?: PosInvoicingSettings;
}

/**
 * Emisión automática al cerrar la venta, activa salvo que la tienda la apague.
 *
 * El default es `true` porque una tienda habilitada ante la DIAN debe soportar
 * cada venta con un documento: dejarlo apagado por defecto convertiría la
 * obligación en un clic que alguien tiene que acordarse de dar. No hay riesgo
 * para quien no factura electrónicamente — la compuerta de habilitación corta
 * antes de crear nada y la venta ni se entera.
 */
export const DEFAULT_POS_AUTO_EMIT = true;

/**
 * Ante un fallo de emisión en el POS, dejar constancia.
 *
 * El default NO es «no hacer nada» porque el riesgo de las dos opciones no es
 * simétrico: anotar de más produce una fila en una cola que alguien revisa;
 * anotar de menos produce una venta sin soporte fiscal que sólo aparece en la
 * declaración del mes siguiente, cuando el consecutivo ya está gastado y el
 * plazo vencido.
 */
export const DEFAULT_POS_DIAN_FAILURE_POLICY: PosDianFailurePolicy = 'queue';

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

  // Invoicing - parámetros de emisión que la ley deja al contribuyente (AIU).
  invoicing?: InvoicingSettings;

  // Services - where the service is performed (home vs shop) + shop address
  services?: ServicesSettings;

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

  // Vexi - the AI assistant's master switch
  vexi?: VexiSettings;

  // Promotions - Evaluation strategy (winner_takes_all vs stacking_groups) & display settings
  promotions?: PromotionsSettings;

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

/**
 * Master switch for the Vexi assistant.
 *
 * Defaults to `false`: Vexi acts on the commerce's own data with the operator's
 * permissions, so each store opts in deliberately. Anything other than an explicit
 * `true` — absent block, absent settings row — reads as off.
 *
 * A store with it off gets no dock at all rather than a disabled one: an assistant
 * that appears and does not answer reads as a fault.
 */
export interface VexiSettings {
  enabled: boolean;

  /**
   * Which engine answers a voice turn.
   *
   * - `realtime` — WebRTC speech-to-speech straight to the provider. One hop, but
   *   audio tokens, and it cannot execute writes: the tools that need
   *   confirmation have no approval surface on that path.
   * - `pipeline` — transcribe, answer with the chat's own text agent, dictate.
   *   Slower on paper and cheaper in practice, and it *inherits* the whole tool
   *   catalog, the confirmation card, the conversation and the write audit,
   *   because a voice turn is literally a chat turn.
   *
   * Defaults to `realtime` so the behaviour of every existing store is unchanged
   * until its numbers say otherwise. This is a separate axis from the interface:
   * the panel toggles chat ⇄ voice at runtime regardless of which engine answers.
   */
  voice_engine?: 'realtime' | 'pipeline';
}

export interface GeneralSettings {
  timezone: string;
  currency: string;
  language: string;
  tax_included: boolean;
  // Campos de la tabla stores (sincronizados)
  name?: string;
  // `null` = borrado explícito del logo; `undefined` = no vino en el payload.
  logo_url?: string | null;
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
  /**
   * Anticipación del aviso de vencimiento de cuotas de CxP, en días (0-30).
   * La consume `ApDueNotificationsJob`: por cada tienda, una cuota planificada
   * genera `ap_installment.due_soon` cuando cae dentro de esta ventana antes de
   * la fecha; `0` desactiva el aviso anticipado (la vencida se re-emite siempre).
   */
  ap_due_soon_days: number;
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
  /** QUI-727 (B.4) — ventas por alias (nombre/mesa) sin cliente formal. */
  allow_alias_sales?: boolean;
  alias_sales_as_default?: boolean;
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

/**
 * Paper formats a printed sale document may take. Closed set on purpose: the
 * invoice's graphic representation carries mandatory content (issuer legal data,
 * CUFE, QR), so the format may change the box but never the contents — a
 * free-text template would let a merchant emit an invalid document.
 *
 * `thermal_*` are roll widths in millimetres; `half_letter` is the common
 * half-page invoice; `letter` is the current hardcoded default.
 */
export const PRINT_FORMATS = [
  'letter',
  'half_letter',
  'a4',
  'thermal_80',
  'thermal_58',
] as const;

/** Derived from the runtime list so `@IsEnum` and the type never drift apart. */
export type PrintFormat = (typeof PRINT_FORMATS)[number];

/**
 * Every document the application can print, as its own configurable unit.
 *
 * The configurable unit is the store × the document type, not the store alone:
 * a dispatch note, a route sheet, a quotation and a POS sale are different
 * papers with different jobs, so one global format would be wrong for most of
 * them. A single global setting was the shape the system grew into by accident
 * — ten emitters each hardcoding their own `@page` — and it is what this list
 * replaces.
 */
export const PRINT_DOCUMENTS = [
  'pos_ticket',
  'invoice',
  /** Short hand-carried dispatch slip for `direct_delivery` (see QUI-659). */
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

/**
 * Per-document print settings. `margin_mm` is ignored for `thermal_*`, whose
 * page is a roll (`<width>mm auto`) with no page margin to speak of.
 */
export interface PrintDocumentConfig {
  format: PrintFormat;
  /** Page margin in millimetres. Ignored on roll formats. */
  margin_mm?: number;
  /** Printed copies. 0 = do not print. */
  copies?: number;
}

/**
 * Per-store, per-document print configuration — the single source of truth the
 * shared print service reads. Scope is the STORE: two stores of the same
 * organization may print differently, and nothing is inherited from the
 * organization. Absent entries fall back to `PRINT_DEFAULTS`.
 */
export type PrintingSettings = Partial<
  Record<PrintDocument, PrintDocumentConfig>
>;

/**
 * System defaults, taken from what the desktop build already does today so a
 * store that never opens this screen keeps printing exactly as before.
 *
 * `dispatch_route` keeps its deliberately thin margin — it needs printable
 * width, and its builder already used a 24 pt margin for that reason.
 *
 * `invoice` is the one entry that CHANGES live behaviour rather than recording
 * it. `invoice_format` is read by `invoice-pdf.service.ts` (`resolveInvoiceFormat`)
 * and defaults to `letter` in `default-store-settings.ts`, so stores already
 * issuing electronic invoices print letter today. Moving the default to an
 * 80 mm roll is a deliberate product decision, not a formalisation — and the
 * graphic representation carries mandatory DIAN content (issuer data, CUFE,
 * QR), so the roll layout must still fit all of it.
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
 * Page geometry per format. `page_size` is the CSS `@page size` rule; without
 * it the browser falls back to its own default and silently ignores the
 * configured paper. `width_mm` is null on roll formats, whose height is `auto`.
 *
 * [print-editor-dsk P1.6] Antes de P1.6 este objeto vivía inline en los 3
 * apps (backend, frontend, mobile) y divergía: `half_letter.width_mm` salía
 * 216 aquí, 216 en frontend, pero mobile no lo declaraba con la misma
 * convención; `css_page_size` nunca existía como concepto compartido.
 *
 * Ahora la fuente única es `libs/print-formats/schemas/page-geometry.json`,
 * copiada byte-a-byte a cada app por `scripts/sync-print-geometry.ts`. Este
 * shim re-exporta el objeto bajo el mismo nombre `PRINT_PAGE_GEOMETRY` para
 * no romper consumidores (`document-print.service.ts`, `paper-defaults.ts`).
 */
export { PRINT_PAGE_GEOMETRY } from '../../print-formats/lib/page-geometry';

export interface ReceiptsSettings {
  print_receipt: boolean;
  email_receipt: boolean;
  receipt_header: string;
  receipt_footer: string;
  /**
   * Electronic-invoicing block, surfaced instead of the receipt toggles once the
   * store is actually issuing electronic invoices — i.e. its DIAN configuration
   * is `environment='production'` with `enablement_status='enabled'`, NOT merely
   * when the fiscal wizard was completed. Optional so settings rows written
   * before this block stay valid.
   */
  auto_issue_invoice?: boolean;
  /** Printed copies per sale. 0 = do not print. */
  invoice_copies?: number;
  send_invoice_email?: boolean;
  print_pos_ticket?: boolean;
  /**
   * Handing the printed graphic representation to the buyer. Colombian law
   * requires the invoice to be DELIVERED to the acquirer, in physical or
   * electronic form — not specifically by email. So this is the second lawful
   * channel, and the UI requires at least one of the two to stay on.
   */
  deliver_printed?: boolean;
  /**
   * @deprecated Superseded by `printing.invoice`. Kept so settings rows written
   * before the per-document block stay valid and can be migrated; it was never
   * read by any printer, so nothing depended on it.
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
   * new top-level section on purpose: `KNOWN_SECTIONS` silently drops unknown
   * sections while still answering 200, so a new section would look saved and
   * never persist. `receipts` is already registered.
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
   * Si true y print_dispatch_ticket_enabled=true, al confirmar una venta
   * postventa se auto-imprime el tiquete de despacho (dispatch_ticket) junto
   * con el documento de venta. Default false (opt-in por admin).
   */
  print_dispatch_ticket_auto_on_postventa?: boolean;
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
  /**
   * When true (default), customers can reschedule a booking directly from
   * the ecommerce portal in a single click — the booking moves to the new
   * slot immediately and the admin gets an in-app broadcast.
   *
   * When false, the customer's reschedule becomes a PENDING REQUEST stored
   * in `booking_reschedule_requests`. The booking's actual date/time stays
   * unchanged until an admin approves it. The customer gets notified on
   * approve/reject.
   *
   * Default: true (preserves the historical behavior where every reschedule
   * was applied directly). Stores that want tighter control flip this off.
   */
  allow_direct_reschedule: boolean;
  /**
   * CP-POS-SVC-PERF-001 — store-level policy that controls whether a
   * POS cashier can persist a `bookings` row for a service line on a
   * draft order (Guardar) or whether scheduling only becomes legal
   * after payment clears (Cobrar / flow/pay).
   *
   *  - true (default): a cashier can attach a booking to a draft
   *    order. POS POSTs /api/store/reservations with the freshly-created
   *    order_id as soon as the draft is saved. Useful for service-
   *    heavy stores (salons, clinics, repair shops) where the cashier
   *    books the slot first and collects payment later.
   *  - false: bookings are only persisted on the Cobrar path. The
   *    draft order survives without a booking until the cashier
   *    charges it; the editor atomic block then attaches the booking.
   *    Useful for stores that want payment guaranteed before any
   *    technician's calendar is locked.
   *
   * Mirrors `ReservationsSettings.allow_bookings_without_payment` in
   * `settings-schemas.dto.ts`.
   */
  allow_bookings_without_payment: boolean;
}

/**
 * The technician's shop address — the "En el local" option of the booking
 * flow. Mirrors `ServicesAddressDto` in `settings-schemas.dto.ts`.
 */
export interface ServicesLocalAddress {
  address_line1: string;
  address_line2: string;
  city: string;
  state_province: string;
  country_code: string;
  postal_code: string;
}

/**
 * Phase 1 of the appointment redesign: where the service is performed.
 *
 * The ecommerce booking flow reads `offer_home_service` to decide whether the
 * "A domicilio" option is shown, and `local_address` as the shop address for
 * the "En el local" option. Captured in Configuración → General → Servicios.
 */
export interface ServicesSettings {
  /**
   * Whether the technician travels to the customer's address. When false the
   * booking flow only offers "En el local". Default: true.
   */
  offer_home_service: boolean;

  /** Shop address used by the "En el local" option. */
  local_address: ServicesLocalAddress;
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

// ============================================================================
// PROMOTIONS - Evaluation strategy (winner_takes_all vs stacking_groups) & UI
// ============================================================================
export type PromotionEvaluationStrategy = 'winner_takes_all' | 'stacking_groups';

export interface PromotionsSettings {
  /**
   * Evaluacion de promociones en cotizaciones, carrito, checkout y POS.
   * - `winner_takes_all` (default): 1 sola promocion ganadora por orden segun priority.
   * - `stacking_groups`: Promociones de alcance disjunto (producto/categoria) se aplican concurrentemente.
   */
  evaluation_strategy: PromotionEvaluationStrategy;
  /**
   * Tope maximo porcentual de descuento acumulado permitido sobre la orden (default 50, rango 1-90).
   * Evita perdidas por acumulacion descontrolada de promociones.
   */
  max_combined_discount_percentage: number;
  /**
   * Permite que las promociones de orden (scope='order') se apliquen sobre el subtotal residual
   * tras los descuentos por item. Default true.
   */
  allow_order_promo_stacking: boolean;
  /**
   * Excluye productos que ya cuenten con una tarifa mayorista (`price_tiers.kind='customer_tier'`)
   * aplicada de recibir promociones automaticas adicionales. Default false.
   */
  exclude_tier_priced_lines: boolean;
  /**
   * Activa la visualizacion gamificada de alta conversion (escalas, badges de ahorro, barra de progreso)
   * en el storefront y POS. Default true.
   */
  enable_high_conversion_ui?: boolean;
}

export interface OperationsSettings {
  default_preparation_time_minutes: number;
  ticket_closing_hour?: number;
}

// ============================================================================
// RESTAURANT - Restaurant suite behavior toggles
// ============================================================================
export type QrScanBehavior = 'menu_only' | 'mark_occupied' | 'open_tab' | 'require_staff';

export interface RestaurantSettings {
  /**
   * Enables paying/closing a table check directly from the table screen
   * (table checkout). When false (default), the check is only paid via
   * the normal POS payment flow.
   */
  enable_table_checkout: boolean;
  /**
   * Behavior when a customer scans a table QR code.
   * - `menu_only` (default): show the digital menu only; no table state change.
   * - `mark_occupied`: mark the table as occupied (no tab opened).
   * - `open_tab`: mark occupied and open a tab (draft order) for the table.
   * - `require_staff`: a staff member must confirm before any action.
   */
  qr_scan_behavior: QrScanBehavior;
  /**
   * When true, scanning the QR auto-fires the order items to KDS/kitchen
   * (same as the POS "fire" action). Default `false` — items stay as a
   * draft until staff fires them.
   */
  qr_auto_fire: boolean;
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
   * Kiosk mode: keeps the QR scanner always-on (continuous loop) on the Aforo
   * tab for an unattended reception tablet. When false (default), the scanner
   * opens on demand and closes after a single decode.
   */
  qr_kiosk_mode?: boolean;
  /**
   * Default display mode for the Aforo QR scanner on open. `fullscreen`
   * (default) shows the full overlay; `floating` opens a movable window/bubble.
   * Per-device overrides are remembered client-side in localStorage.
   */
  qr_scanner_default_mode?: 'fullscreen' | 'floating';
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
  /**
   * Re-entry detection policy. When a member is granted access again within
   * `re_entry_window_hours` of their last `granted` access:
   *   - `off`   → no detection (current behavior).
   *   - `warn`  → still grant, but flag it (`warning: true` + `re_entry_minutes`)
   *               without re-counting aforo or re-consuming quota. Default.
   *   - `block` → deny with `denied_re_entry` (anti pass-back).
   * Default `'warn'`.
   */
  re_entry_mode?: 'off' | 'warn' | 'block';
  /**
   * Window in hours used by `re_entry_mode` to consider an access a re-entry.
   * Default `2`.
   */
  re_entry_window_hours?: number;
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

  // Plan Despacho Economía — FASE 2 paso 9. Defaults globales de la tienda
  // usados como fallback cuando un método de envío no define política.
  default_payment_timing?: 'prepaid' | 'on_delivery';
  default_settlement_type?: 'none' | 'per_delivery' | 'per_route';
  default_cost_settlement_timing?: 'immediate_on_close';
  default_origin_location_id?: number;
  requires_dispatch_address?: boolean;
}
