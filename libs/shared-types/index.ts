// Shared enums and minimal interfaces for layouts and domain apps

export enum DomainApp {
  VENDIX_LANDING = 'VENDIX_LANDING',
  VENDIX_ADMIN = 'VENDIX_ADMIN',
  ORG_LANDING = 'ORG_LANDING',
  ORG_ADMIN = 'ORG_ADMIN',
  STORE_LANDING = 'STORE_LANDING',
  STORE_ADMIN = 'STORE_ADMIN',
  STORE_ECOMMERCE = 'STORE_ECOMMERCE',
}

export enum LayoutKey {
  auth = 'auth',
  admin = 'admin',
  pos = 'pos',
  storefront = 'storefront',
  superadmin = 'superadmin',
}

export type RoleName =
  | 'super_admin'
  | 'owner'
  | 'admin'
  | 'manager'
  | 'supervisor'
  | 'employee'
  | 'customer';

export interface DomainBranding {
  name?: string;
  primary_color?: string;
  secondary_color?: string;
  background_color?: string;
  accent_color?: string;
  border_color?: string;
  text_color?: string;
  theme?: 'light' | 'dark' | string;
  logo_url?: string | null;
  favicon_url?: string | null;
}

export interface DomainConfig {
  app: DomainApp | string; // tolerate unknowns during migration
  branding?: DomainBranding;
  organization_id?: string | number | null;
  store_id?: string | number | null;
  // ...other config keys present in backend
}

export interface UserProfile {
  id: string;
  email: string;
  roles: RoleName[];
  preferredLayout?: LayoutKey;
  defaultOrganizationId?: string | number;
  defaultStoreId?: string | number;
}

export interface LayoutRouteContext {
  domainApp: DomainApp | string;
  orgId?: string | number | null;
  storeId?: string | number | null;
}
