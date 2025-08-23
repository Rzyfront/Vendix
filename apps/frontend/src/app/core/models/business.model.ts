export interface Store {
  id: number;
  organization_id: number;
  name: string;
  slug: string;
  store_code?: string;
  logo_url?: string;
  color_primary?: string;
  color_secondary?: string;
  domain?: string;
  timezone?: string;
  currency_code?: string;
  operating_hours?: any;
  store_type: 'physical' | 'online' | 'hybrid';
  is_active: boolean;
  manager_user_id?: number;
  created_at?: Date;
  updated_at?: Date;
}

export interface Organization {
  id: number;
  name: string;
  slug: string;
  legal_name?: string;
  tax_id?: string;
  email: string;
  phone?: string;
  website?: string;
  logo_url?: string;
  description?: string;
  state: 'active' | 'inactive' | 'suspended';
  created_at?: Date;
  updated_at?: Date;
}

export interface User {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  state: 'active' | 'inactive' | 'pending_verification';
}
