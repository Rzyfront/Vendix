import type { ISODateString } from './common.types';

export interface Role {
  id: string;
  name: string;
  code: string;
  description?: string;
  is_system: boolean;
  is_active: boolean;
  permissions: string[];
  user_count?: number;
  organization_id: string;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface RolePermission {
  key: string;
  label: string;
  module: string;
  description?: string;
  category?: string;
}

export interface CreateRoleInput {
  name: string;
  code: string;
  description?: string;
  permissions: string[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  permissions?: string[];
  is_active?: boolean;
}
