export interface PosCustomer {
  id: string;
  email: string;
  name: string;
  phone?: string;
  documentType?: 'dni' | 'passport' | 'cedula' | 'other';
  documentNumber?: string;
  address?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePosCustomerRequest {
  email: string;
  name: string;
  phone?: string;
  documentType?: 'dni' | 'passport' | 'cedula' | 'other';
  documentNumber?: string;
  address?: string;
}

export interface SearchCustomersRequest {
  query?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedCustomersResponse {
  customers: PosCustomer[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface CustomerValidationError {
  field: string;
  message: string;
}
