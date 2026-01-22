export interface TenantConfig {
  organization: OrganizationConfig;
  store?: StoreConfig;
  branding: BrandingConfig;
  theme: ThemeConfig;
  features: FeatureFlags;
  seo: SEOConfig;
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
  slider?: {
    enable?: boolean;
    photos?: any[];
  };
}

export interface OrganizationConfig {
  id: string;
  slug: string;
  name: string;
  description?: string;
  account_type?: 'SINGLE_STORE' | 'MULTI_STORE_ORG';
  domains: {
    useCustomDomain: boolean;
    customDomain?: string;
    organizationUrl: string;
    adminUrls: string[];
    storeUrls: string[];
  };
  subscription: {
    plan: string;
    allowedStores: number;
    customDomainAllowed: boolean;
    features: string[];
  };
  settings: {
    timezone: string;
    currency: string;
    language: string;
    dateFormat: string;
  };
}

export interface StoreConfig {
  id: string;
  slug: string;
  name: string;
  description?: string;
  organizationId: string;
  domains: {
    useCustomDomain: boolean;
    customDomain?: string;
    ecommerceUrl: string;
    adminUrl: string;
  };
  settings: {
    currency: string;
    language: string;
    timezone: string;
    taxIncluded: boolean;
    allowGuestCheckout: boolean;
  };
  status: 'active' | 'inactive' | 'suspended';
}

export interface BrandingConfig {
  logo: {
    url: string;
    alt: string;
    width?: number;
    height?: number;
  };
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: {
      primary: string;
      secondary: string;
      muted: string;
    };
  };
  fonts: {
    primary: string;
    secondary?: string;
    headings?: string;
  };
  customCSS?: string;
  favicon?: string;
}

export interface ThemeConfig {
  name: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  borderRadius: string;
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  shadows: {
    sm: string;
    md: string;
    lg: string;
  };
}

export interface FeatureFlags {
  // Vendix features
  onboarding: boolean;
  superAdmin: boolean;

  // Organization features
  multiStore: boolean;
  userManagement: boolean;
  analytics: boolean;

  // Store features
  inventory: boolean;
  pos: boolean;
  orders: boolean;
  customers: boolean;
  reports: boolean;

  // E-commerce features
  guestCheckout: boolean;
  wishlist: boolean;
  reviews: boolean;
  coupons: boolean;
  shipping: boolean;
  payments: boolean;

  // Dynamic features
  [key: string]: boolean;
}

export interface SEOConfig {
  title: string;
  description: string;
  keywords: string[];
  ogImage?: string;
  ogTitle?: string;
  ogDescription?: string;
  twitterCard?: string;
  twitterSite?: string;
  canonicalUrl?: string;
  robots?: string;
}
