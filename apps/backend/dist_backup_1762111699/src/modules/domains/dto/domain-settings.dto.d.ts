export declare class BrandingConfigDto {
    companyName?: string;
    storeName?: string;
    logoUrl?: string;
    favicon?: string;
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
}
export declare class SeoConfigDto {
    title?: string;
    description?: string;
    keywords?: string[];
    ogImage?: string;
    ogType?: string;
    robots?: string;
    canonicalUrl?: string;
}
export declare class FeaturesConfigDto {
    multiStore?: boolean;
    userManagement?: boolean;
    analytics?: boolean;
    customDomain?: boolean;
    inventory?: boolean;
    pos?: boolean;
    orders?: boolean;
    customers?: boolean;
    guestCheckout?: boolean;
    wishlist?: boolean;
    reviews?: boolean;
    coupons?: boolean;
    shipping?: boolean;
    payments?: boolean;
    apiAccess?: boolean;
    webhooks?: boolean;
    customThemes?: boolean;
    advancedAnalytics?: boolean;
}
export declare class ThemeConfigDto {
    layout?: 'sidebar' | 'topbar' | 'minimal';
    sidebarMode?: 'expanded' | 'collapsed' | 'overlay';
    colorScheme?: 'light' | 'dark' | 'auto';
    borderRadius?: string;
    fontFamily?: string;
    customCss?: string;
}
export declare class EcommerceConfigDto {
    currency?: string;
    locale?: string;
    timezone?: string;
    taxCalculation?: 'manual' | 'automatic' | 'disabled';
    shippingEnabled?: boolean;
    digitalProductsEnabled?: boolean;
    subscriptionsEnabled?: boolean;
}
export declare class IntegrationsConfigDto {
    googleAnalytics?: string;
    googleTagManager?: string;
    facebookPixel?: string;
    hotjar?: string;
    intercom?: string;
    crisp?: string;
}
export declare class SecurityConfigDto {
    forceHttps?: boolean;
    hsts?: boolean;
    contentSecurityPolicy?: string;
    allowedOrigins?: string[];
}
export declare class PerformanceConfigDto {
    cacheTtl?: number;
    cdnEnabled?: boolean;
    compressionEnabled?: boolean;
    imageLazyLoading?: boolean;
}
export declare class CreateDomainConfigDto {
    branding?: BrandingConfigDto;
    seo?: SeoConfigDto;
    features?: FeaturesConfigDto;
    theme?: ThemeConfigDto;
    ecommerce?: EcommerceConfigDto;
    integrations?: IntegrationsConfigDto;
    security?: SecurityConfigDto;
    performance?: PerformanceConfigDto;
}
export declare class CreateDomainSettingDto {
    hostname: string;
    domainType?: string;
    status?: string;
    sslStatus?: string;
    isPrimary?: boolean;
    ownership?: string;
    organizationId: number;
    storeId?: number;
    config: CreateDomainConfigDto;
}
export declare class UpdateDomainSettingDto {
    config?: CreateDomainConfigDto;
    domainType?: string;
    status?: string;
    sslStatus?: string;
    isPrimary?: boolean;
    ownership?: string;
}
export declare class ValidateHostnameDto {
    hostname: string;
}
export declare class DuplicateDomainDto {
    newHostname: string;
}
export declare class VerifyDomainDto {
    checks?: ('txt' | 'cname' | 'a' | 'aaaa')[];
    force?: boolean;
    expectedCname?: string;
    expectedA?: string[];
    mode?: string;
}
export interface VerifyDomainResult {
    hostname: string;
    statusBefore: string;
    statusAfter: string;
    sslStatus: string;
    verified: boolean;
    nextAction?: string;
    checks: Record<string, any>;
    suggestedFixes?: string[];
    timestamp: string;
    errorCode?: string;
}
