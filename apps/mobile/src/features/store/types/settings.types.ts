export interface StoreSettings {
  name: string;
  tax_id?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  logo_url?: string;
  currency?: string;
  country?: string;
}

export interface StoreUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role_id?: string;
  role_name?: string;
  state: 'active' | 'inactive';
  created_at: string;
}

export interface StoreRole {
  id: string;
  name: string;
  description?: string;
  user_count: number;
  is_default: boolean;
}

export interface SettingsPaymentMethod {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

export interface CreateStoreUserDto {
  first_name: string;
  last_name: string;
  email: string;
  role_id?: string;
  send_invite?: boolean;
}

export interface UpdateStoreUserDto {
  first_name?: string;
  last_name?: string;
  email?: string;
  role_id?: string;
}

export interface CreateStoreRoleDto {
  name: string;
  description?: string;
}

export interface UpdateStoreRoleDto {
  name?: string;
  description?: string;
}
