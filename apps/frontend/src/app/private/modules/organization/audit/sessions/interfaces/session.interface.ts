export interface UserSession {
  id: number;
  user_id: number;
  token: string;
  is_active: boolean;
  ip_address?: string;
  user_agent?: string;
  last_activity: string;
  created_at: string;
  expires_at?: string;
  users?: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
  };
}

export interface SessionsQueryDto {
  page?: number;
  limit?: number;
  user_id?: number;
  status?: 'active' | 'inactive';
}

export interface PaginatedSessionsResponse {
  data: UserSession[];
  meta?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
