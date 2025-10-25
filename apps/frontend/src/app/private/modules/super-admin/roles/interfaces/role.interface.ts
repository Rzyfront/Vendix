export interface Role {
  id: number;
  name: string;
  description: string;
  is_system_role: boolean;
  created_at?: string;
  updated_at?: string;
  role_permissions?: any[];
  user_roles?: any[];
  _count?: {
    user_roles: number;
  };
}

export interface PaginatedRolesResponse {
  data: Role[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}
