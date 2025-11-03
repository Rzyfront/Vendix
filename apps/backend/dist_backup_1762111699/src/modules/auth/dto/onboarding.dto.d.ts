export declare enum OnboardingStep {
    VERIFY_EMAIL = "verify_email",
    CREATE_ORGANIZATION = "create_organization",
    SETUP_ORGANIZATION = "setup_organization",
    CREATE_STORE = "create_store",
    SETUP_STORE = "setup_store",
    COMPLETE = "complete"
}
export declare class OnboardingStatusDto {
    email_verified: boolean;
    canCreateOrganization: boolean;
    hasOrganization: boolean;
    organizationId?: number;
    currentStep: OnboardingStep;
    completedSteps: OnboardingStep[];
    nextStepUrl?: string;
}
export declare class CreateOrganizationOnboardingDto {
    name: string;
    legal_name?: string;
    email?: string;
    phone?: string;
    website?: string;
    description?: string;
    industry?: string;
    tax_id?: string;
    slug?: string;
}
export declare class SetupOrganizationDto {
    logo_url?: string;
    banner_url?: string;
    timezone?: string;
    currency?: string;
    language?: string;
    date_format?: string;
    address_line1?: string;
    address_line2?: string;
    city?: string;
    state_province?: string;
    postal_code?: string;
    country_code?: string;
}
export declare class CreateStoreOnboardingDto {
    name: string;
    description?: string;
    store_type?: 'physical' | 'online' | 'hybrid';
    store_code?: string;
    domain?: string;
    slug?: string;
}
export declare class SetupStoreDto {
    currency?: string;
    timezone?: string;
    language?: string;
    track_inventory?: boolean;
    allow_backorders?: boolean;
    low_stock_threshold?: number;
    enable_shipping?: boolean;
    free_shipping_threshold?: number;
    enable_cod?: boolean;
    enable_online_payments?: boolean;
    address_line1?: string;
    address_line2?: string;
    city?: string;
    state_province?: string;
    postal_code?: string;
    country_code?: string;
    phone?: string;
    email?: string;
}
