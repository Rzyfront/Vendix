export enum StoreType {
  PHYSICAL = 'physical',
  ONLINE = 'online',
  HYBRID = 'hybrid',
  POPUP = 'popup',
  KIOSKO = 'kiosko',
}

export enum StoreState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  DRAFT = 'draft',
  SUSPENDED = 'suspended',
  ARCHIVED = 'archived',
}

export interface OperatingHours {
  monday?: { open: string; close: string };
  tuesday?: { open: string; close: string };
  wednesday?: { open: string; close: string };
  thursday?: { open: string; close: string };
  friday?: { open: string; close: string };
  saturday?: { open: string; close: string };
  sunday?: { open: string; close: string };
}

export interface StoreSettings {
  theme?: string;
  notifications?: boolean;
  language?: string;
  currency_format?: string;
  email_notifications?: boolean;
  sms_notifications?: boolean;
  inventory_alerts?: boolean;
  low_stock_threshold?: number;
  allow_guest_checkout?: boolean;
  require_email_verification?: boolean;
  enable_inventory_tracking?: boolean;
  enable_tax_calculation?: boolean;
  tax_rate?: number;
  enable_shipping?: boolean;
  free_shipping_threshold?: number;
  currency?: string;
  timezone?: string;
  color_primary?: string;
  color_secondary?: string;
  logo_url?: string;
}

export interface StoreAddress {
  id?: number;
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state_province?: string | null;
  postal_code?: string | null;
  country_code: string;
  phone_number?: string | null;
  is_primary?: boolean;
}

export interface Store {
  id: number;
  name: string;
  slug: string;
  store_code: string | null;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  manager_user_id: number | null;
  organization_id: number;
  store_type: StoreType;
  timezone: string;
  onboarding: boolean;
  logo_url?: string | null;
  primary_address?: string | null;
  description?: string;
  email?: string;
  phone?: string;
  website?: string;
  domain?: string;
  currency_code?: string;
  color_primary?: string;
  color_secondary?: string;
  operating_hours?: OperatingHours;
  status?: StoreState | 'active' | 'inactive' | 'maintenance';
  settings?: StoreSettings;
  addresses?: StoreAddress[];
  organizations?: {
    id: number;
    name: string;
    slug: string;
  };
  _count?: {
    products: number;
    orders: number;
    store_users: number;
  };
  products_count?: number;
  orders_count?: number;
  users_count?: number;
}

export interface StoreListItem {
  id: number;
  name: string;
  slug: string;
  store_code: string | null;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  manager_user_id: number | null;
  organization_id: number;
  store_type: StoreType;
  timezone: string;
  onboarding: boolean;
  logo_url?: string | null;
  primary_address?: string | null;
  products_count: number;
  orders_count: number;
  users_count: number;
  organizations?: {
    id: number;
    name: string;
    slug: string;
  };
  addresses?: StoreAddress[];
  _count?: {
    products: number;
    orders: number;
    store_users: number;
  };
}

export interface CreateStoreDto {
  organization_id?: number;
  name: string;
  slug?: string;
  store_code?: string;
  logo_url?: string;
  domain?: string;
  timezone?: string;
  currency_code?: string;
  operating_hours?: OperatingHours;
  store_type: StoreType;
  is_active?: boolean;
  manager_user_id?: number;
  description?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: {
    address_line1: string;
    address_line2?: string;
    city: string;
    state_province?: string;
    postal_code?: string;
    country_code: string;
    phone_number?: string;
  };
  settings?: {
    currency_code?: string;
    color_primary?: string;
    color_secondary?: string;
  };
}

export interface UpdateStoreDto {
  name?: string;
  slug?: string;
  store_code?: string;
  store_type?: StoreType;
  is_active?: boolean;
  status?: StoreState | 'active' | 'inactive' | 'maintenance';
  manager_user_id?: number | null;
  description?: string;
  email?: string;
  phone?: string;
  website?: string;
  domain?: string;
  logo_url?: string;
  banner_url?: string;
  color_primary?: string;
  color_secondary?: string;
  timezone?: string;
  currency_code?: string;
  operating_hours?: OperatingHours;
  address?: {
    address_line1: string;
    address_line2?: string;
    city: string;
    state_province?: string;
    postal_code?: string;
    country_code: string;
    phone_number?: string;
  };
  settings?: Partial<StoreSettings>;
}

export interface StoreStats {
  total_stores: number;
  active_stores: number;
  inactive_stores?: number;
  total_orders: number;
  total_revenue: number;
  total_products?: number;
}

export interface StoreDashboardResponse {
  store_id: number;
  metrics: {
    total_orders: number;
    total_revenue: number;
    low_stock_products: number;
    active_customers: number;
    revenue_today: number;
    revenue_this_week: number;
    average_order_value: number;
  };
  recent_orders?: any[];
  top_products?: any[];
  sales_chart?: any[];
}

export interface StoreQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  store_type?: StoreType;
  is_active?: boolean;
  status?: StoreState | 'active' | 'inactive';
}

export interface StoreSettingsUpdateDto {
  settings: Partial<StoreSettings>;
}
