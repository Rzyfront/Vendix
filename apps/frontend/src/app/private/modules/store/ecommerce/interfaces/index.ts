/**
 * E-commerce Settings Interface
 * Matches backend EcommerceSettingsDto structure
 */

/**
 * Colores de la sección inicio
 */
export interface InicioColores {
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
}

/**
 * Sección Inicio de e-commerce
 */
export interface InicioSettings {
  titulo?: string;
  parrafo?: string;
  logo_url?: string | null;
  colores?: InicioColores;
}

export interface EcommerceSettings {
  // App type identifier
  app?: string;

  // Sección Inicio
  inicio?: InicioSettings;

  // Configuración General
  general?: {
    currency?: string;
    locale?: string;
    timezone?: string;
  };

  // Slider Principal
  slider?: {
    enable?: boolean;
    photos?: SliderPhoto[];
  };

  // Catálogo
  catalog?: {
    products_per_page?: number;
    show_out_of_stock?: boolean;
    allow_reviews?: boolean;
    show_variants?: boolean;
    show_related_products?: boolean;
    enable_filters?: boolean;
  };

  // Carrito
  cart?: {
    allow_guest_checkout?: boolean;
    cart_expiration_hours?: number;
    max_quantity_per_item?: number;
    save_for_later?: boolean;
  };

  // Checkout
  checkout?: {
    require_registration?: boolean;
    guest_email_required?: boolean;
    create_account_after_order?: boolean;
    terms_required?: boolean;
    guest_newsletter_opt_in?: boolean;
  };

  // Envíos
  shipping?: {
    free_shipping_threshold?: number | null;
    calculate_tax_before_shipping?: boolean;
    multiple_shipping_addresses?: boolean;
  };

  // Footer
  footer?: FooterSettings;
}

// ============================================================================
// FOOTER SETTINGS - Configuración del pie de página del ecommerce
// ============================================================================

/**
 * Información de la tienda para el footer
 */
export interface FooterStoreInfo {
  about_us?: string;
  support_email?: string;
  tagline?: string;
}

/**
 * Enlace del footer
 */
export interface FooterLink {
  label: string;
  url: string;
  is_external?: boolean;
}

/**
 * Item de FAQ
 */
export interface FooterFaqItem {
  question: string;
  answer: string;
}

/**
 * Sección de ayuda del footer
 */
export interface FooterHelp {
  faq?: FooterFaqItem[];
  shipping_info?: string;
  returns_info?: string;
}

/**
 * Cuenta de red social
 */
export interface FooterSocialAccount {
  username?: string;
  url?: string;
}

/**
 * Redes sociales del footer
 */
export interface FooterSocial {
  facebook?: FooterSocialAccount;
  instagram?: FooterSocialAccount;
  tiktok?: FooterSocialAccount;
}

/**
 * Configuración completa del footer
 */
export interface FooterSettings {
  store_info?: FooterStoreInfo;
  links?: FooterLink[];
  help?: FooterHelp;
  social?: FooterSocial;
}

/**
 * Single slider photo configuration
 */
export interface SliderPhoto {
  url?: string | null;
  key?: string | null; // S3 key
  title?: string;
  caption?: string;
}

/**
 * Slider image for UI state management
 */
export interface SliderImage {
  url?: string;
  key?: string; // S3 key
  thumbnail?: string;
  uploading?: boolean;
  title?: string;
  caption?: string;
}

/**
 * Response from GET /settings endpoint
 */
export interface SettingsResponse {
  exists: boolean;
  config?: EcommerceSettings;
  ecommerceUrl?: string; // URL del dominio de Ecommerce activo
}

/**
 * Request body for updating settings
 */
export interface UpdateEcommerceSettingsDto {
  ecommerce: EcommerceSettings;
}

/**
 * Upload response from S3
 */
export interface UploadImageResponse {
  key: string;
  url?: string;
  thumbKey?: string;
}
