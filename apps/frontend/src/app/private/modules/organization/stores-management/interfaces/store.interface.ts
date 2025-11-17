// Local enum definitions to avoid circular dependencies
export enum StoreType {
  PHYSICAL = 'physical',
  ONLINE = 'online',
  HYBRID = 'hybrid',
  POPUP = 'popup',
  KIOSKO = 'kiosko'
}

export enum StoreState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  DRAFT = 'draft',
  SUSPENDED = 'suspended',
  ARCHIVED = 'archived'
}

export interface Store {
  // Core properties from API
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
  organizations: {
    id: number;
    name: string;
    slug: string;
  };
  addresses: Array<{
    id: number;
    store_id: number;
    address_line1: string;
    address_line2: string | null;
    city: string;
    state_province: string;
    country_code: string;
    postal_code: string;
    phone_number: string | null;
    type: string;
    is_primary: boolean;
    latitude: number | null;
    longitude: number | null;
    organization_id: number | null;
    user_id: number | null;
  }>;
  _count: {
    products: number;
    orders: number;
    store_users: number;
  };

  // Additional UI properties
  description?: string;
  email?: string;
  phone?: string;
  website?: string;
  domain?: string;
  currency_code?: string;
  logo_url?: string;
  banner_url?: string;
  color_primary?: string;
  color_secondary?: string;
  operating_hours?: OperatingHours;
  status?: StoreState | 'active' | 'inactive' | 'maintenance';
  settings?: StoreSettings;
  address?: Address | string;
  stats?: StoreStatsItem;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  is_primary: boolean;
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
  allowGuestCheckout?: boolean;
  requireEmailVerification?: boolean;
  enableInventoryTracking?: boolean;
  enableTaxCalculation?: boolean;
  taxRate?: number;
  enableShipping?: boolean;
  freeShippingThreshold?: number;
  currency?: string;
  timezone?: string;
}

export interface StoreStatsItem {
  productsCount: number;
  ordersCount: number;
  revenue: number;
  customersCount: number;
  averageOrderValue: number;
  conversionRate: number;
}

export interface StoreStats {
  total_stores?: number;
  active_stores?: number;
  inactive_stores?: number;
  totalStores?: number;
  activeStores?: number;
  inactiveStores?: number;
  storesGrowthRate?: number;
  activeStoresGrowthRate?: number;
  totalRevenue?: number;
  revenueGrowthRate?: number;
  totalProducts?: number;
  productsGrowthRate?: number;
  totalOrders?: number;
  ordersGrowthRate?: number;
  averageOrderValue?: number;
  aovGrowthRate?: number;
  conversionRate?: number;
  conversionGrowthRate?: number;
  customerSatisfaction?: number;
  satisfactionGrowthRate?: number;
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
  organizations: {
    id: number;
    name: string;
    slug: string;
  };
  addresses: Array<{
    id: number;
    store_id: number;
    address_line1: string;
    address_line2: string | null;
    city: string;
    state_province: string;
    country_code: string;
    postal_code: string;
    phone_number: string | null;
    type: string;
    is_primary: boolean;
    latitude: number | null;
    longitude: number | null;
    organization_id: number | null;
    user_id: number | null;
  }>;
  _count: {
    products: number;
    orders: number;
    store_users: number;
  };
  // Additional fields for UI compatibility
  description?: string;
  email?: string;
  phone?: string;
  website?: string;
  domain?: string;
  currency_code?: string;
  logo_url?: string;
  banner_url?: string;
  color_primary?: string;
  color_secondary?: string;
  operating_hours?: OperatingHours;
  status?: StoreState | 'active' | 'inactive' | 'maintenance';
  settings?: StoreSettings;
  address?: Address | string;
  stats?: StoreStatsItem;
}

export interface CreateStoreDto {
  organization_id?: number;
  name: string;
  slug?: string;
  store_code: string;
  logo_url?: string;
  banner_url?: string;
  color_primary?: string;
  color_secondary?: string;
  domain?: string;
  timezone?: string;
  currency_code?: string;
  operating_hours?: OperatingHours;
  store_type: StoreType;
  is_active?: boolean;
  manager_user_id?: number;
  description?: string;
  email: string;
  phone?: string;
  website?: string;
  address?: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    is_primary?: boolean;
  };
  settings?: StoreSettings;
}

export interface UpdateStoreDto {
  name?: string;
  is_active?: boolean;
  store_type?: StoreType;
  status?: StoreState | 'active' | 'inactive' | 'maintenance';
  manager_user_id?: number | null;
  description?: string;
  email?: string;
  phone?: string;
  website?: string;
  domain?: string;
  address?: Address | string; // Allow both object and string for compatibility
  logo_url?: string;
  banner_url?: string;
  color_primary?: string;
  color_secondary?: string;
  timezone?: string;
  currency_code?: string;
  operating_hours?: OperatingHours;
  settings?: StoreSettings;
}

export interface StoreQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  store_type?: StoreType;
  is_active?: boolean;
  status?: StoreState | 'active' | 'inactive' | 'maintenance';
  organization_id?: number;
}

export interface StoreFilters {
  search: string;
  store_type: StoreType | '';
  is_active: boolean;
  status: StoreState | 'active' | 'inactive' | 'maintenance' | '';
  organization_id?: number;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export interface StoreTableColumn {
  key: string;
  label: string;
  sortable: boolean;
  width?: string;
}

export interface StoreTableAction {
  label: string;
  icon: string;
  action: (store: StoreListItem) => void;
  disabled?: (store: StoreListItem) => boolean;
  danger?: boolean;
}

export interface PaginatedStoresResponse {
  data: StoreListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

// Additional interfaces from super-admin for compatibility
export interface StoreDashboardDto {
  start_date?: string;
  end_date?: string;
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
  recent_orders: Array<any>;
  top_products: Array<any>;
  sales_chart: Array<any>;
}

export interface StoreSettingsUpdateDto {
  settings: Partial<StoreSettings>;
}

// Enums defined locally to avoid circular dependencies