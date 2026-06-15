// TODO(shared-types): replace with `export type AppType = DomainApp` from
// `@vendix/shared-types` once libs/shared-types/index.d.ts is regenerated.
// Tracked as a Knowledge Gap in the org-admin parity plan.
export type AppType =
  | 'VENDIX_LANDING'
  | 'VENDIX_ADMIN'
  | 'ORG_LANDING'
  | 'ORG_ADMIN'
  | 'STORE_LANDING'
  | 'STORE_ADMIN'
  | 'STORE_ECOMMERCE';

export interface LoginCredentials {
  email: string;
  password: string;
  organization_slug?: string;
  store_slug?: string;
}

export interface RegisterData {
  organizationName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  password: string;
}

export interface ForgotPasswordData {
  email: string;
}

export interface User {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  state?: string;
  phone?: string;
  avatar_url?: string | null;
  organization_id?: number;
  main_store_id?: number;
  // Profile fields returned by /auth/me and other profile endpoints
  // (added to unblock typescheck on profile.tsx — these were already
  // consumed by the UI before the type was extended).
  document_type?: string;
  document_number?: string;
  addresses?: {
    address_line1?: string;
    address_line2?: string;
    city?: string;
    state_province?: string;
    country?: string;
    country_code?: string;
    postal_code?: string;
  }[];
  created_at?: string;
  roles: string[];
  organizations?: {
    id: number;
    name: string;
    slug: string;
    logo_url?: string | null;
    onboarding?: any;
    domain_settings?: any;
  };
  store?: {
    id: number;
    name: string;
    slug: string;
    store_type?: string;
    logo_url?: string | null;
    onboarding?: any;
    organizations?: {
      id: number;
      name: string;
      slug: string;
      domain_settings?: any;
    };
  };
}

export interface UserSettings {
  id: number;
  user_id: number;
  app_type: AppType;
  config: {
    panel_ui?: Record<string, Record<string, boolean>>;
    preferences?: {
      theme?: 'light' | 'dark' | 'system';
    };
  };
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in?: number;
}

export interface AuthResponse {
  user: User;
  user_settings: UserSettings;
  store_settings?: any;
  default_panel_ui?: Record<string, Record<string, boolean>> | null;
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in?: number;
}
