export interface Organization {
  id: number;
  name: string;
  slug: string;
  description: string;
  status: 'active' | 'inactive' | 'suspended' | 'pending';
  plan: 'basic' | 'premium' | 'enterprise';
  settings: OrganizationSettings;
  branding: OrganizationBranding;
  contact: OrganizationContact;
  limits: OrganizationLimits;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationSettings {
  allowPublicStore: boolean;
  allowMultipleStores: boolean;
  maxStores: number;
  maxUsers: number;
  features: {
    ecommerce: boolean;
    inventory: boolean;
    analytics: boolean;
    multiCurrency: boolean;
    taxManagement: boolean;
    shippingManagement: boolean;
  };
}

export interface OrganizationBranding {
  logo?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
  customCss?: string;
}

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