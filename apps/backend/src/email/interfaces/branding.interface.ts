/**
 * Branding configuration for personalized emails
 * Extracted from domain_settings.config.branding
 */
export interface EmailBranding {
  company_name?: string;
  store_name?: string;
  logo_url?: string;
  favicon_url?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  background_color?: string;
  text_color?: string;
}

/**
 * Options for welcome email customization
 */
export interface WelcomeEmailOptions {
  userType: 'owner' | 'staff' | 'customer';
  branding?: EmailBranding;
  organizationSlug?: string;
  storeSlug?: string;
  organizationName?: string;
  storeName?: string;
}
