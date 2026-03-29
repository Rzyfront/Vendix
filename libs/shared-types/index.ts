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

// ─── Booking System Types ────────────────────────────────────────────

export enum BookingStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  NO_SHOW = 'no_show',
}

export interface Booking {
  id: number;
  store_id: number;
  customer_id: number;
  product_id: number;
  booking_number: string;
  date: string;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  channel: string;
  notes?: string;
  internal_notes?: string;
  order_id?: number;
  created_by_user_id?: number;
  created_at: string;
  updated_at: string;
  customer?: { id: number; first_name: string; last_name: string; email: string; phone?: string };
  product?: { id: number; name: string; service_duration_minutes?: number; image_url?: string };
}

export interface AvailabilitySlot {
  date: string;
  start_time: string;
  end_time: string;
  available_providers: { id: number; display_name: string; avatar_url?: string }[];
  total_available: number;
}

export interface ServiceProvider {
  id: number;
  store_id: number;
  employee_id: number;
  is_active: boolean;
  display_name?: string;
  avatar_url?: string;
  bio?: string;
  sort_order: number;
}

export interface ProviderSchedule {
  id: number;
  provider_id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

export interface ProviderException {
  id: number;
  provider_id: number;
  date: string;
  is_unavailable: boolean;
  custom_start_time?: string;
  custom_end_time?: string;
  reason?: string;
}

export interface BookingStats {
  today_count: number;
  pending_count: number;
  confirmed_count: number;
  cancellation_rate: number;
  no_show_rate: number;
  occupancy_rate: number;
}
