// Re-export from environment.enum.ts for compatibility
export { DomainType, AppType, AppEnvironment } from './environment.enum';
import { AppType as AppTypeImport } from './environment.enum';
import { Currency } from '../../shared/pipes/currency/currency.pipe';

// ============================================================================
// Domain Config (Frontend internal state)
// ============================================================================
export interface DomainConfig {
  domainType: string; // DomainType enum value
  environment: AppTypeImport; // AppType enum value
  organization_slug?: string;
  store_slug?: string;
  organization_id?: number;
  store_id?: number;
  customConfig?: DomainCustomConfig;
  isVendixDomain: boolean;
  hostname: string;
}

// ============================================================================
// Custom Config (data from backend)
// ============================================================================
export interface DomainCustomConfig {
  // NUEVO: Branding desde store_settings
  branding?: BrandingConfig;
  fonts?: FontsConfig;
  ecommerce?: EcommerceConfig;
  publication?: PublicationConfig;
  currency?: Currency;

  // Legacy: Security y routing metadata
  security?: {
    cors_origins?: string[];
    session_timeout?: number;
    max_login_attempts?: number;
  };
  routing?: {
    is_primary?: boolean;
    custom_hostname_redirect?: string;
  };

  // Legacy: Landing page config (para compatibilidad con org-landing y store-landing)
  title?: string;
  description?: string;
  features?: Record<string, any>;
}

// ============================================================================
// Branding Config (desde store_settings.branding)
// ============================================================================
export interface BrandingConfig {
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
// Fonts Config (desde store_settings.fonts)
// ============================================================================
export interface FontsConfig {
  primary: string;
  secondary: string;
  headings: string;
}

// ============================================================================
// Publication Config (desde store_settings.publication)
// ============================================================================
export interface PublicationConfig {
  store_published: boolean;
  ecommerce_enabled: boolean;
  landing_enabled: boolean;
  maintenance_mode: boolean;
  maintenance_message?: string;
  allow_public_access: boolean;
}

// ============================================================================
// Ecommerce Config (desde store_settings.ecommerce)
// ============================================================================
export interface EcommerceConfig {
  enabled: boolean;
  slider?: {
    enable: boolean;
    photos: Array<{ url?: string; title?: string; caption?: string }>;
  };
  inicio?: {
    titulo?: string;
    parrafo?: string;
    logo_url?: string;
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
    whatsapp_checkout?: boolean;
    whatsapp_number?: string;
  };
  shipping?: {
    free_shipping_threshold?: number;
    calculate_tax_before_shipping: boolean;
    multiple_shipping_addresses: boolean;
  };
}

// ============================================================================
// Domain Resolution Response (API response)
// ============================================================================
export interface DomainResolutionResponse {
  success: boolean;
  message: string;
  data: DomainResolution;
}

// ============================================================================
// Domain Resolution (data from backend /public/domains/resolve)
// ============================================================================
export interface DomainResolution {
  id: number;
  hostname: string;
  organization_id: number;
  store_id?: number;

  // NUEVO: app_type directo del backend (única fuente de verdad)
  app: string; // AppType enum value from backend

  // NUEVO: Branding desde store_settings
  branding?: BrandingConfig;
  fonts?: FontsConfig;

  // NUEVO: Ecommerce settings desde store_settings
  ecommerce?: EcommerceConfig;

  // NUEVO: Publication settings desde store_settings
  publication?: PublicationConfig;

  // Currency details from store settings
  currency?: Currency;

  // Config (sin app - app_type es campo directo)
  config?: {
    branding?: any;
    security?: any;
  };

  created_at: string;
  updated_at: string;
  organization_name: string;
  organization_slug: string;
  domain_type: string; // Legacy: domain_type_enum value
  raw_domain_type?: 'vendix_core' | 'organization' | 'store' | 'ecommerce';
  status: string;
  ssl_status: string;
  is_primary: boolean;
  store_slug?: string;
  store_name?: string;
  ownership?: string;
}
