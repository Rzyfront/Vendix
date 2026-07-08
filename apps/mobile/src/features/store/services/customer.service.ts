import { apiClient, Endpoints } from '@/core/api';
import { unwrapPaginated } from '@/core/api/pagination';
import type {
  ApiResponse,
  PaginatedResponse,
  Customer,
  CustomerWithWallet,
  CustomerStats,
  CustomerQuery,
  CreateCustomerDto,
  UpdateCustomerDto,
} from '../types';

function unwrap<T>(response: { data: T | ApiResponse<T> }): T {
  const d = response.data as ApiResponse<T>;
  if (d && typeof d === 'object' && 'success' in d) return d.data;
  return response.data as T;
}

function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      if (Array.isArray(value)) {
        value.forEach((v) => parts.push(`${key}=${encodeURIComponent(String(v))}`));
      } else {
        parts.push(`${key}=${encodeURIComponent(String(value))}`);
      }
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export const CustomerService = {
  async stats(storeId: number): Promise<CustomerStats> {
    const endpoint = Endpoints.STORE.CUSTOMERS.STATS.replace(':storeId', String(storeId));
    const res = await apiClient.get(endpoint);
    return unwrap<CustomerStats>(res);
  },

  async list(query?: CustomerQuery): Promise<PaginatedResponse<Customer>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      search: query?.search,
      state: query?.state,
    };
    const res = await apiClient.get(`${Endpoints.STORE.CUSTOMERS.LIST}${buildQuery(params)}`);
    return unwrapPaginated<Customer>(res, { page: query?.page ?? 1, limit: query?.limit ?? 20 });
  },

  async getById(id: string): Promise<CustomerWithWallet> {
    const endpoint = Endpoints.STORE.CUSTOMERS.GET.replace(':id', id);
    const res = await apiClient.get(endpoint);
    return unwrap<CustomerWithWallet>(res);
  },

  async create(data: CreateCustomerDto): Promise<Customer> {
    const res = await apiClient.post(Endpoints.STORE.CUSTOMERS.CREATE, data);
    return unwrap<Customer>(res);
  },

  async update(id: string, data: UpdateCustomerDto): Promise<Customer> {
    const endpoint = Endpoints.STORE.CUSTOMERS.UPDATE.replace(':id', id);
    const res = await apiClient.patch(endpoint, data);
    return unwrap<Customer>(res);
  },

  async delete(id: string): Promise<void> {
    const endpoint = Endpoints.STORE.CUSTOMERS.DELETE.replace(':id', id);
    await apiClient.delete(endpoint);
  },

  async searchCustomers(query: string, limit = 20): Promise<PaginatedResponse<Customer>> {
    const res = await apiClient.get(
      `${Endpoints.STORE.CUSTOMERS.SEARCH}?search=${encodeURIComponent(query)}&limit=${limit}`,
    );
    return unwrapPaginated<Customer>(res, { page: 1, limit });
  },

  async topup(
    id: string,
    amount: number,
    description?: string,
    payment_method?: string,
  ): Promise<CustomerWithWallet> {
    const endpoint = Endpoints.STORE.CUSTOMERS.TOPUP.replace(':id', id);
    const res = await apiClient.post(endpoint, { amount, description, payment_method });
    return unwrap<CustomerWithWallet>(res);
  },

  async adjust(
    id: string,
    type: 'credit' | 'debit',
    amount: number,
    reason: string,
    reference?: string,
  ): Promise<CustomerWithWallet> {
    const endpoint = Endpoints.STORE.CUSTOMERS.ADJUST.replace(':id', id);
    const res = await apiClient.post(endpoint, { type, amount, reason, reference });
    return unwrap<CustomerWithWallet>(res);
  },

  async getBulkUploadTemplate(): Promise<Blob> {
    const res = await apiClient.get(
      `${Endpoints.STORE.CUSTOMERS.LIST}/bulk/template/download`,
      { responseType: 'blob' },
    );
    return res.data as Blob;
  },

  async uploadBulkCustomers(
    customers: Array<{
      email?: string;
      first_name: string;
      last_name: string;
      phone?: string;
      document_type?: string;
      document_number?: string;
    }>,
  ): Promise<{
    success: boolean;
    total_processed: number;
    successful: number;
    failed: number;
    results: Array<{
      status: 'success' | 'error';
      message?: string;
      row_number?: number;
      customer?: { id: string };
    }>;
  }> {
    const res = await apiClient.post(`${Endpoints.STORE.CUSTOMERS.LIST}/bulk/upload`, {
      customers,
    });
    return unwrap<any>(res);
  },
};
