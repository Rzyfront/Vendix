import type { ISODateString, Address } from './common.types';

export type StoreType = 'PHYSICAL' | 'ONLINE' | 'HYBRID';

export interface StoreListItem {
  id: string;
  name: string;
  slug: string;
  store_code: string;
  store_type: StoreType;
  timezone: string;
  is_active: boolean;
  manager_user_id?: string | null;
  manager_name?: string | null;
  organization_id: string;
  addresses: Address[];
  onboarding: boolean;
  created_at: ISODateString;
  updated_at: ISODateString;
  _count?: {
    products: number;
    orders: number;
    store_users: number;
  };
}

export interface StoreDetail extends StoreListItem {
  email?: string;
  phone?: string;
  logo_url?: string;
  description?: string;
  tax_id?: string;
  settings?: Record<string, unknown>;
}

export interface CreateStoreInput {
  name: string;
  slug: string;
  store_code: string;
  store_type: StoreType;
  timezone?: string;
  email?: string;
  phone?: string;
  address?: Address;
  manager_user_id?: string;
}

export interface UpdateStoreInput {
  name?: string;
  store_type?: StoreType;
  timezone?: string;
  email?: string;
  phone?: string;
  address?: Address;
  is_active?: boolean;
  manager_user_id?: string | null;
}
