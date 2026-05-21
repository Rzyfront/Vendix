import { apiClient, Endpoints } from '@/core/api';
import { unwrapPaginated } from '@/core/api/pagination';
import type { ApiResponse, PaginatedResponse } from '../types';

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

export interface QuotationItem {
  product_id?: number;
  product_variant_id?: number;
  product_name: string;
  variant_sku?: string;
  quantity: number;
  unit_price: number;
  discount_amount?: number;
  tax_rate?: number;
  tax_amount_item?: number;
  total_price: number;
  notes?: string;
}

export interface CreateQuotationDto {
  customer_id?: number;
  channel?: string;
  valid_until?: string;
  notes?: string;
  internal_notes?: string;
  terms_and_conditions?: string;
  items: QuotationItem[];
}

export interface Quotation {
  id: number;
  store_id: string;
  customer_id: number | null;
  quotation_number: string;
  status: string;
  channel: string | null;
  valid_until: string | null;
  notes: string | null;
  internal_notes: string | null;
  terms_and_conditions: string | null;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total: number;
  items: QuotationItem[];
  created_at: string;
  updated_at: string;
}

export const QuotationService = {
  async list(query?: { page?: number; limit?: number; search?: string; status?: string }): Promise<PaginatedResponse<Quotation>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      search: query?.search,
      status: query?.status,
    };
    const res = await apiClient.get(`${Endpoints.STORE.QUOTATIONS.LIST}${buildQuery(params)}`);
    return unwrapPaginated<Quotation>(res, { page: query?.page ?? 1, limit: query?.limit ?? 20 });
  },

  async getById(id: number): Promise<Quotation> {
    const endpoint = Endpoints.STORE.QUOTATIONS.GET.replace(':id', String(id));
    const res = await apiClient.get(endpoint);
    return unwrap<Quotation>(res);
  },

  async create(dto: CreateQuotationDto): Promise<Quotation> {
    const res = await apiClient.post(Endpoints.STORE.QUOTATIONS.CREATE, dto);
    return unwrap<Quotation>(res);
  },

  async update(id: number, dto: Partial<CreateQuotationDto>): Promise<Quotation> {
    const endpoint = Endpoints.STORE.QUOTATIONS.UPDATE.replace(':id', String(id));
    const res = await apiClient.patch(endpoint, dto);
    return unwrap<Quotation>(res);
  },

  async remove(id: number): Promise<void> {
    const endpoint = Endpoints.STORE.QUOTATIONS.DELETE.replace(':id', String(id));
    await apiClient.delete(endpoint);
  },

  async send(id: number): Promise<Quotation> {
    const endpoint = Endpoints.STORE.QUOTATIONS.SEND.replace(':id', String(id));
    const res = await apiClient.post(endpoint);
    return unwrap<Quotation>(res);
  },

  async accept(id: number): Promise<Quotation> {
    const endpoint = Endpoints.STORE.QUOTATIONS.ACCEPT.replace(':id', String(id));
    const res = await apiClient.post(endpoint);
    return unwrap<Quotation>(res);
  },

  async reject(id: number): Promise<Quotation> {
    const endpoint = Endpoints.STORE.QUOTATIONS.REJECT.replace(':id', String(id));
    const res = await apiClient.post(endpoint);
    return unwrap<Quotation>(res);
  },

  async cancel(id: number): Promise<Quotation> {
    const endpoint = Endpoints.STORE.QUOTATIONS.CANCEL.replace(':id', String(id));
    const res = await apiClient.post(endpoint);
    return unwrap<Quotation>(res);
  },

  async convertToOrder(id: number): Promise<Quotation> {
    const endpoint = Endpoints.STORE.QUOTATIONS.CONVERT.replace(':id', String(id));
    const res = await apiClient.post(endpoint);
    return unwrap<Quotation>(res);
  },

  async duplicate(id: number): Promise<Quotation> {
    const endpoint = Endpoints.STORE.QUOTATIONS.DUPLICATE.replace(':id', String(id));
    const res = await apiClient.post(endpoint);
    return unwrap<Quotation>(res);
  },
};
