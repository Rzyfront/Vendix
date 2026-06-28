import { apiClient, Endpoints } from '@/core/api';
import { unwrapPaginated } from '@/core/api/pagination';
import type {
  ApiResponse,
  Brand,
  BrandQuery,
  BrandStats,
  CreateBrandDto,
  PaginatedResponse,
  UpdateBrandDto,
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
      parts.push(`${key}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export const BrandService = {
  async list(query?: BrandQuery): Promise<PaginatedResponse<Brand>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      search: query?.search,
      state: query?.state,
      is_featured: query?.is_featured,
      sort_by: query?.sort_by,
      sort_order: query?.sort_order,
    };
    const res = await apiClient.get(`${Endpoints.STORE.BRANDS.LIST}${buildQuery(params)}`);
    return unwrapPaginated<Brand>(res, { page: query?.page ?? 1, limit: query?.limit ?? 20 });
  },

  async getById(id: number): Promise<Brand> {
    const endpoint = Endpoints.STORE.BRANDS.GET.replace(':id', String(id));
    const res = await apiClient.get(endpoint);
    return unwrap<Brand>(res);
  },

  async create(data: CreateBrandDto): Promise<Brand> {
    const res = await apiClient.post(Endpoints.STORE.BRANDS.CREATE, data);
    return unwrap<Brand>(res);
  },

  async update(id: number, data: UpdateBrandDto): Promise<Brand> {
    const endpoint = Endpoints.STORE.BRANDS.UPDATE.replace(':id', String(id));
    const res = await apiClient.patch(endpoint, data);
    return unwrap<Brand>(res);
  },

  async delete(id: number, force = false): Promise<void> {
    const endpoint = `${Endpoints.STORE.BRANDS.DELETE.replace(':id', String(id))}${force ? '?force=true' : ''}`;
    await apiClient.delete(endpoint);
  },

  async stats(query?: { state?: string; is_featured?: boolean }): Promise<BrandStats> {
    const res = await apiClient.get(`${Endpoints.STORE.BRANDS.LIST}/stats${buildQuery(query as Record<string, unknown>)}`);
    return unwrap<BrandStats>(res);
  },

  async getAllActive(): Promise<Brand[]> {
    const res = await apiClient.get(`${Endpoints.STORE.BRANDS.LIST}${buildQuery({ state: 'active', limit: 100 })}`);
    return unwrapPaginated<Brand>(res, { page: 1, limit: 100 }).data;
  },
};

export type { BrandService as BrandServiceType };