export interface Store {
  id: number;
  name: string;
  slug: string;
  description?: string;
  email: string;
  phone?: string;
  website?: string;
  address?: string;
  city?: string;
  country?: string;
  logo_url?: string;
  banner_url?: string;
  settings?: StoreSettings;
  state: StoreState;
  organization_id: number;
  organization?: {
    id: number;
    name: string;
  };
  created_at: string;
  updated_at: string;
}

export interface StoreSettings {
  allow_public_store: boolean;
  allow_multiple_locations: boolean;
  enable_ecommerce: boolean;
  enable_inventory: boolean;
  enable_analytics: boolean;
  default_currency: string;
  timezone: string;
  locale: string;
  max_products?: number;
  max_users?: number;
}

export enum StoreState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  DRAFT = 'draft',
  SUSPENDED = 'suspended',
  ARCHIVED = 'archived'
}

export interface StoreListItem {
  id: number;
  name: string;
  slug: string;
  email: string;
  phone?: string;
  city?: string;
  country?: string;
  state: StoreState;
  organization_id: number;
  organization_name: string;
  products_count?: number;
  orders_count?: number;
  revenue?: number;
  created_at: string;
}

export interface StoreDetails extends Store {
  stats: {
    totalProducts: number;
    activeProducts: number;
    totalOrders: number;
    completedOrders: number;
    totalRevenue: number;
    totalUsers: number;
  };
  recentActivity: Array<{
    id: number;
    action: string;
    timestamp: string;
    user: {
      name: string;
      email: string;
    };
  }>;
}

export interface CreateStoreDto {
  name: string;
  slug: string;
  description?: string;
  email: string;
  phone?: string;
  website?: string;
  address?: string;
  city?: string;
  country?: string;
  logo_url?: string;
  banner_url?: string;
  settings?: Partial<StoreSettings>;
  state?: StoreState;
  organization_id: number;
}

export interface UpdateStoreDto {
  name?: string;
  slug?: string;
  description?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  city?: string;
  country?: string;
  logo_url?: string;
  banner_url?: string;
  settings?: Partial<StoreSettings>;
  state?: StoreState;
}

export interface StoreQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  state?: StoreState;
  organization_id?: number;
}

export interface StoreDashboardDto {
  start_date?: string;
  end_date?: string;
}

export interface StoreDashboardResponse {
  totalProducts: number;
  activeProducts: number;
  totalOrders: number;
  completedOrders: number;
  totalRevenue: number;
  totalUsers: number;
}

export interface StoreFilters {
  search: string;
  state: string;
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
  active: number;
  inactive: number;
  draft: number;
  suspended: number;
  archived: number;
  total_revenue: number;
  total_orders: number;
  total_products: number;
}

export interface PaginatedStoresResponse {
  data: Store[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}