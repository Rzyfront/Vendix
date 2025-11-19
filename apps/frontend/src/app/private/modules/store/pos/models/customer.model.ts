export interface PosCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name?: string;
  name?: string; // For backward compatibility
  phone?: string;
  document_type?: string;
  document_number?: string;
  address?: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreatePosCustomerRequest {
  email: string;
  first_name: string;
  last_name?: string;
  phone?: string;
  document_type?: string;
  document_number?: string;
  address?: string;
  store_id: number;
  password?: string;
}

export interface SearchCustomersRequest {
  query?: string;
  limit?: number;
  page?: number;
}

export interface PaginatedCustomersResponse {
  data: PosCustomer[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CustomerValidationError {
  field: string;
  message: string;
}
