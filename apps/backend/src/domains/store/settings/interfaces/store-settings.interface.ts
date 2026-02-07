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
  title?: string;
  caption?: string;
}

export interface EcommerceSettings {
  enabled: boolean;
  slider?: {
    enable: boolean;
    photos: EcommerceSliderPhoto[];
  };
  inicio?: {
    titulo?: string;
    parrafo?: string;
    logo_url?: string;
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

export interface StoreSettings {
  // NUEVAS SECCIONES - Única fuente de verdad
  branding: BrandingSettings;
  fonts: FontsSettings;
  publication: PublicationSettings;
  ecommerce?: EcommerceSettings;

  // Panel UI - Control de módulos disponibles a nivel de tienda
  panel_ui?: PanelUISettings;

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
  enable_schedule_validation: boolean;
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
