import { apiClient, Endpoints } from '@/core/api';
import { unwrapPaginated } from '@/core/api/pagination';
import type { ApiResponse, PaginatedResponse } from '@/features/store/types';

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

export interface OrgStore {
  id: number;
  name: string;
  store_type: string;
  state: string;
  is_active: boolean;
  store_code: string;
  slug: string;
  logo_url: string | null;
  primary_address: string | null;
  products_count: number;
  orders_count: number;
  users_count: number;
}

export interface OrgStoreStats {
  total_stores: number;
  active_stores: number;
  total_orders: number;
  total_revenue: number;
}

export const OrgStoreService = {
  async list(query?: { page?: number; limit?: number; search?: string; store_type?: string; is_active?: boolean }): Promise<PaginatedResponse<OrgStore>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 50,
      search: query?.search,
      store_type: query?.store_type,
      is_active: query?.is_active,
    };
    const res = await apiClient.get(`${Endpoints.ORGANIZATION.STORES.LIST}${buildQuery(params)}`);
    return unwrapPaginated<OrgStore>(res, { page: query?.page ?? 1, limit: query?.limit ?? 50 });
  },

  async getById(id: number): Promise<OrgStore> {
    const endpoint = Endpoints.ORGANIZATION.STORES.GET.replace(':id', String(id));
    const res = await apiClient.get(endpoint);
    return unwrap<OrgStore>(res);
  },

  async stats(): Promise<OrgStoreStats> {
    const res = await apiClient.get(Endpoints.ORGANIZATION.STORES.STATS);
    return unwrap<OrgStoreStats>(res);
  },
};
