import type { FiscalStatusBlock } from './fiscal-status.model';

export interface Organization {
  id: number;
  name: string;
  slug: string;
  description: string;
  status: 'active' | 'inactive' | 'suspended' | 'pending';
  plan: 'basic' | 'premium' | 'enterprise';
  settings: OrganizationSettings;
  account_type?: OrganizationAccountType;
  operating_scope?: OrganizationOperatingScope;
  fiscal_scope?: OrganizationFiscalScope;
  branding: OrganizationBranding;
  contact: OrganizationContact;
  limits: OrganizationLimits;
  createdAt: Date;
  updatedAt: Date;
}

export enum OrganizationAccountType {
  SINGLE_STORE = 'SINGLE_STORE',
  MULTI_STORE_ORG = 'MULTI_STORE_ORG',
}

export type OrganizationOperatingScope = 'STORE' | 'ORGANIZATION';
export type OrganizationFiscalScope = 'STORE' | 'ORGANIZATION';

export interface OrganizationInventorySettings {
  mode: 'organizational' | 'independent';
  low_stock_alerts_scope: 'location' | 'store' | 'org';
  fallback_on_stockout: 'reject' | 'ask_user' | 'auto_next_available';
  costing_method?: 'weighted_average' | 'fifo';
}

export interface OrganizationSettings {
  branding: OrganizationBrandingSettings;
  inventory?: OrganizationInventorySettings;
  fonts?: OrganizationFonts;
  panel_ui?: OrganizationPanelUISettings;
  payroll?: unknown;
}

export interface OrganizationBrandingSettings {
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
}

export interface OrganizationFonts {
  primary: string;
  secondary: string;
  headings: string;
}

export interface OrganizationPanelUISettings {
  ORG_ADMIN?: Record<string, boolean>;
}

export type OrganizationBranding = OrganizationBrandingSettings;

export interface OrganizationContact {
  email: string;
  phone?: string;
  address?: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
}

export interface OrganizationLimits {
  products: number;
  orders: number;
  storage: number; // in MB
  bandwidth: number; // in GB
}

export interface OrganizationStats {
  totalStores: number;
  activeStores: number;
  totalUsers: number;
  totalProducts: number;
  totalOrders: number;
  totalRevenue: number;
  activeSubscriptions: number;
}

export interface OrganizationUser {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: 'owner' | 'admin' | 'manager' | 'viewer';
  status: 'active' | 'inactive' | 'pending';
  lastLogin?: Date;
  permissions: string[];
  createdAt: Date;
}

export interface OrganizationStore {
  id: number;
  name: string;
  slug: string;
  description?: string;
  status: 'active' | 'inactive' | 'maintenance';
  type: 'physical' | 'online' | 'hybrid';
  settings: StoreSettings;
  contact: StoreContact;
  metrics: StoreMetrics;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreSettings {
  currency: string;
  language: string;
  timezone: string;
  taxEnabled: boolean;
  shippingEnabled: boolean;
  inventoryManagement: boolean;
  fiscal_status?: FiscalStatusBlock;
}

export interface StoreContact {
  email: string;
  phone?: string;
  address?: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
}

export interface StoreMetrics {
  totalProducts: number;
  totalOrders: number;
  totalCustomers: number;
  monthlyRevenue: number;
  conversionRate: number;
  averageOrderValue: number;
}
