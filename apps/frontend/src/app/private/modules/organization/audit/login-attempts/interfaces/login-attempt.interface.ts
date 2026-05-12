export interface LoginAttempt {
  id: number;
  email: string;
  success: boolean;
  ip_address?: string;
  user_agent?: string;
  attempted_at: string;
  store_id?: number;
  stores?: {
    id: number;
    name: string;
    slug: string;
  };
}

export interface LoginAttemptsStats {
  total_attempts: number;
  successful_attempts: number;
  failed_attempts: number;
  success_rate: number;
}

export interface LoginAttemptsQueryDto {
  page?: number;
  limit?: number;
  email?: string;
  success?: boolean;
  store_id?: number;
}

export interface PaginatedLoginAttemptsResponse {
  data: LoginAttempt[];
  meta?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
