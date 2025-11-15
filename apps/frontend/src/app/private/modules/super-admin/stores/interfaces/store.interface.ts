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
  id: number;
  name: string;
  slug: string;
  store_code: string;
  description?: string;
  email: string;
  phone?: string;
  website?: string;
  address?: string;
  city?: string;
  country?: string;
  logo_url?: string;
  color_primary?: string;
  color_secondary?: string;
  domain?: string;
  timezone?: string;
  currency_code?: string;
  operating_hours?: OperatingHours;
  store_type: StoreType;
  is_active: boolean;
  manager_user_id?: number;
  settings?: StoreSettings;
  organization_id: number;
  organization?: {
    id: number;
    name: string;
  };
  created_at: string;
  updated_at: string;
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
}

export interface StoreListItem {
  id: number;
  name: string;
  slug: string;
  store_code: string;
  store_type: StoreType;
  timezone: string;
  is_active: boolean;
  manager_user_id?: number;
  organization_id: number;
  logo_url?: string;
  created_at: string;
  updated_at: string;
  organizations?: {
    id: number;
    name: string;
    slug: string;
  };
  addresses?: Array<{
    id: number;
    store_id: number;
    address_line1: string;
    address_line2?: string;
    city: string;
    state_province: string;
    country_code: string;
    postal_code: string;
    phone_number?: string;
    type: string;
    is_primary: boolean;
    latitude?: number;
    longitude?: number;
    organization_id?: number;
    user_id?: number;
  }>;
  _count?: {
    products: number;
    orders: number;
    store_users: number;
  };
}

export interface StoreDetails extends Store {
  addresses?: Array<{
    id: number;
    street: string;
    city: string;
    country: string;
    postal_code: string;
    is_primary: boolean;
  }>;
  store_users?: Array<{
    id: number;
    user_id: number;
    role: string;
    user: {
      id: number;
      name: string;
      email: string;
    };
  }>;
}

export interface CreateStoreDto {
  organization_id: number;
  name: string;
  slug: string;
  store_code: string;
  logo_url?: string;
  color_primary?: string;
  color_secondary?: string;
  domain?: string;
  timezone?: string;
  currency_code?: string;
  operating_hours?: OperatingHours;
  store_type: StoreType;
  is_active: boolean;
  manager_user_id?: number;
  description?: string;
  email: string;
  phone?: string;
  website?: string;
  address?: string;
  city?: string;
  country?: string;
}

export interface UpdateStoreDto {
  name?: string;
  is_active?: boolean;
  store_type?: StoreType;
  manager_user_id?: number;
  description?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  city?: string;
  country?: string;
  logo_url?: string;
  color_primary?: string;
  color_secondary?: string;
  domain?: string;
  timezone?: string;
  currency_code?: string;
  operating_hours?: OperatingHours;
}

export interface StoreQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  store_type?: StoreType;
  is_active?: boolean;
  organization_id?: number;
}

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

export interface StoreFilters {
  search: string;
  store_type: StoreType;
  is_active: boolean;
  organization_id: number;
  dateRange: {
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

export interface StoreStats {
  total_stores: number;
  active_stores: number;
  inactive_stores: number;
  suspended_stores: number;
  draft_stores: number;
  total_revenue: number;
  total_orders: number;
  total_products: number;
}

export interface PaginatedStoresResponse {
  data: StoreListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}