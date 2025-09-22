export interface StandardResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: {
    code?: string;
    details?: any;
  };
  timestamp?: string;
  path?: string;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResponse<T> extends StandardResponse<T[]> {
  meta?: PaginationMeta;
}